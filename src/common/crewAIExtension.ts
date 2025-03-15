// CrewAI Extension Class
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { spawn, ChildProcess } from 'child_process';
import { EXTENSION_ROOT_DIR, CREWAI_MAIN_SCRIPT, TRIBE_FOLDER, CREWAI_VENV_PYTHON } from './constants';
import { traceError, traceInfo, traceDebug } from './log/logging';
import { getInterpreterDetails } from './python';
import { LearningSystem } from './learningSystem';

/**
 * CrewAI Extension class that extends the base CrewAI functionality
 * with dynamic agent creation, task assignment, and other features.
 */
export class CrewAIExtension {
    private _pythonProcess: ChildProcess | undefined;
    private _projectPath: string | undefined;
    private _pythonPath: string[] | undefined;
    private _learningSystem: LearningSystem | undefined;
    private _outputListeners: ((data: string) => void)[] = [];
    
    constructor(private readonly _context: vscode.ExtensionContext) {
        // Initialize the project path from the workspace root if available
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this._projectPath = workspaceFolders[0].uri.fsPath;
            this._learningSystem = new LearningSystem(this._projectPath);
            traceInfo(`Initialized CrewAIExtension with project path: ${this._projectPath}`);
        } else {
            traceInfo('CrewAIExtension initialized without a project path');
        }
    }
    
    /**
     * Start the CrewAI server
     */
    public async startServer(projectPath: string): Promise<boolean> {
        try {
            // Initialize project folder structure if it doesn't exist
            await this._ensureProjectStructure(projectPath);
            
            // First check if a server is already running for this project
            const isRunning = await this._isServerRunning();
            if (isRunning) {
                traceInfo('CrewAI server is already running');
                this._projectPath = projectPath;
                return true;
            }
            
            // If we have a process but the server isn't running, stop it
            if (this._pythonProcess) {
                await this.stopServer();
            }
            
            this._projectPath = projectPath;
            
            // Find the crewai_venv Python interpreter - specific for this project
            const venvPythonPath = path.join(EXTENSION_ROOT_DIR, 'crewai_venv', 'bin', 'python');
            
            if (fs.existsSync(venvPythonPath)) {
                this._pythonPath = [venvPythonPath];
                traceInfo(`Using dedicated CrewAI virtual environment: ${venvPythonPath}`);
            } else if (fs.existsSync(CREWAI_VENV_PYTHON)) {
                this._pythonPath = [CREWAI_VENV_PYTHON];
                traceInfo(`Using CrewAI virtual environment: ${CREWAI_VENV_PYTHON}`);
            } else {
                // Fall back to system Python
                const interpreterDetails = await getInterpreterDetails();
                if (!interpreterDetails.path) {
                    traceError('Python interpreter not found. Cannot start CrewAI server.');
                    return false;
                }
                
                this._pythonPath = interpreterDetails.path;
                traceInfo(`Using system Python: ${this._pythonPath[0]}`);
            }
            
            // Path to the CrewAI server script
            const serverScriptPath = path.join(EXTENSION_ROOT_DIR, 'bundled', 'tool', CREWAI_MAIN_SCRIPT);
            
            // Create .tribe folder if it doesn't exist
            const tribeFolderPath = path.join(projectPath, TRIBE_FOLDER);
            await fs.ensureDir(tribeFolderPath);
            
            // Delete any existing port file before starting the server
            const portFilePath = path.join(tribeFolderPath, 'server_port.txt');
            if (await fs.pathExists(portFilePath)) {
                await fs.remove(portFilePath);
            }
            
            // Check if server script exists
            if (!fs.existsSync(serverScriptPath)) {
                traceError(`CrewAI server script not found at ${serverScriptPath}`);
                return false;
            }
            
            // Launch the Python process
            this._pythonProcess = spawn(this._pythonPath[0], [
                serverScriptPath,
                '--project-path', projectPath
            ], {
                cwd: projectPath,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Handle stdout
            this._pythonProcess.stdout?.on('data', (data) => {
                const dataStr = data.toString();
                traceInfo(`CrewAI server: ${dataStr}`);
                
                // Notify output listeners
                this._outputListeners.forEach(listener => {
                    try {
                        listener(dataStr);
                    } catch (error) {
                        traceError(`Error in output listener: ${error}`);
                    }
                });
            });
            
            // Handle stderr
            this._pythonProcess.stderr?.on('data', (data) => {
                const dataStr = data.toString();
                traceError(`CrewAI server error: ${dataStr}`);
                
                // Notify output listeners for stderr as well - important for progress markers
                this._outputListeners.forEach(listener => {
                    try {
                        listener(dataStr);
                    } catch (error) {
                        traceError(`Error in output listener: ${error}`);
                    }
                });
            });
            
            // Handle process exit
            this._pythonProcess.on('exit', (code, signal) => {
                if (code !== 0) {
                    traceError(`CrewAI server exited with code ${code} and signal ${signal}`);
                }
                this._pythonProcess = undefined;
            });
            
            // Return a promise that resolves when server starts or rejects after timeout
            return new Promise((resolve, reject) => {
                // Set a timeout for server startup
                const startupTimeout = setTimeout(() => {
                    if (this._pythonProcess) {
                        this._pythonProcess.kill();
                        this._pythonProcess = undefined;
                    }
                    reject(new Error('CrewAI server startup timed out'));
                }, 30000); // 30 second timeout
                
                // Check if a port file has been created
                const checkPortFile = async () => {
                    try {
                        if (await fs.pathExists(portFilePath)) {
                            // Port file exists, read it
                            const portStr = await fs.readFile(portFilePath, 'utf8');
                            const port = parseInt(portStr.trim(), 10);
                            if (!isNaN(port)) {
                                // Try to connect to the server
                                const net = require('net');
                                const client = new net.Socket();
                                
                                client.connect(port, 'localhost', () => {
                                    // Connection successful, server is running
                                    clearTimeout(startupTimeout);
                                    client.destroy();
                                    traceInfo(`CrewAI server started successfully on port ${port}`);
                                    resolve(true);
                                });
                                
                                client.on('error', () => {
                                    // Connection failed, try again after a delay
                                    client.destroy();
                                    setTimeout(checkPortFile, 500);
                                });
                                
                                return;
                            }
                        }
                        
                        // Port file doesn't exist or is invalid, try again after a delay
                        setTimeout(checkPortFile, 500);
                    } catch (error) {
                        // Error reading port file, try again after a delay
                        setTimeout(checkPortFile, 500);
                    }
                };
                
                // Start checking for the port file
                setTimeout(checkPortFile, 1000);
            });
            
        } catch (error) {
            traceError('Failed to start CrewAI server:', error);
            // Clean up any process that might have been created
            if (this._pythonProcess) {
                this._pythonProcess.kill();
                this._pythonProcess = undefined;
            }
            return false;
        }
    }
    
    /**
     * Stop the CrewAI server
     * 
     * @param force If true, use stronger measures to ensure the server is stopped
     */
    public async stopServer(force: boolean = false): Promise<void> {
        if (this._pythonProcess) {
            try {
                // First try gentle SIGTERM
                this._pythonProcess.kill();
                
                if (force) {
                    // If force is specified, also send SIGKILL after a short delay
                    await new Promise(resolve => setTimeout(resolve, 500));
                    try {
                        this._pythonProcess.kill('SIGKILL');
                    } catch (error) {
                        // Ignore errors - process might be already gone
                    }
                }
                
                this._pythonProcess = undefined;
                traceInfo('CrewAI server stopped');
            } catch (error) {
                traceError('Error killing Python process:', error);
                // Continue with cleanup even if there's an error
                this._pythonProcess = undefined;
            }
        }
        
        // Also try to clean up the port file
        if (this._projectPath) {
            try {
                const portFilePath = path.join(this._projectPath, TRIBE_FOLDER, 'server_port.txt');
                if (await fs.pathExists(portFilePath)) {
                    await fs.remove(portFilePath);
                    traceInfo('Removed server port file');
                }
            } catch (error) {
                traceError('Error removing port file:', error);
            }
        }
    }
    
    /**
     * Get the port the CrewAI server is running on
     */
    private async _getServerPort(): Promise<number> {
        try {
            // Default port to use in case of any issues
            const DEFAULT_PORT = 9876;
            
            if (!this._projectPath) {
                traceError('Project path not set, using default port');
                return DEFAULT_PORT;
            }
            
            // Check if there's a port file
            const portFilePath = path.join(this._projectPath, TRIBE_FOLDER, 'server_port.txt');
            if (await fs.pathExists(portFilePath)) {
                const portStr = await fs.readFile(portFilePath, 'utf8');
                const port = parseInt(portStr.trim(), 10);
                if (!isNaN(port)) {
                    return port;
                }
            } else {
                // If port file doesn't exist, create it with the default port
                try {
                    // Ensure the .tribe folder exists
                    await fs.ensureDir(path.join(this._projectPath, TRIBE_FOLDER));
                    // Write the default port to the file
                    await fs.writeFile(portFilePath, DEFAULT_PORT.toString(), 'utf8');
                    traceInfo(`Created server port file with default port ${DEFAULT_PORT}`);
                } catch (writeError) {
                    traceError('Error creating server port file:', writeError);
                }
            }
            
            // Default port if no port file or invalid port
            return DEFAULT_PORT;
        } catch (error) {
            traceError('Error getting server port:', error);
            return 9876; // Default port as fallback
        }
    }
    
    /**
     * Check if the CrewAI server is running
     */
    private async _isServerRunning(): Promise<boolean> {
        // If we have a process, we assume it's running
        if (this._pythonProcess) {
            return true;
        }
        
        try {
            const port = await this._getServerPort();
            const net = require('net');
            
            return new Promise<boolean>((resolve) => {
                const client = new net.Socket();
                
                // Set a short timeout
                client.setTimeout(500);
                
                client.connect(port, 'localhost', () => {
                    // Connection successful, server is running
                    client.destroy();
                    resolve(true);
                });
                
                client.on('error', () => {
                    // Connection failed, server is not running
                    client.destroy();
                    resolve(false);
                });
                
                client.on('timeout', () => {
                    // Connection timed out, server is not running
                    client.destroy();
                    resolve(false);
                });
            });
        } catch (error) {
            traceError('Error checking if server is running:', error);
            return false;
        }
    }
    
    /**
     * Send a request to the CrewAI server
     */
    public async sendRequest(command: string, payload: any): Promise<any> {
        // Check if the server is running
        const isRunning = await this._isServerRunning();
        if (!isRunning) {
            traceError('Cannot send request: CrewAI server is not running');
            
            // Try to restart the server if we have a project path
            if (this._projectPath) {
                traceInfo('Attempting to restart the CrewAI server...');
                try {
                    const started = await this.startServer(this._projectPath);
                    if (!started) {
                        throw new Error('Failed to restart the CrewAI server');
                    }
                    traceInfo('CrewAI server restarted successfully');
                } catch (restartError) {
                    traceError('Failed to restart CrewAI server:', restartError);
                    throw new Error('CrewAI server is not running and could not be restarted. Please restart the extension.');
                }
            } else {
                throw new Error('CrewAI server is not running. Please restart the extension.');
            }
        }
        
        try {
            // Enhanced payload with learning context if this is a message or agent request
            let enhancedPayload = { ...payload };
            
            // Add learning context for send_message and create_agent commands
            if (this._learningSystem && (command === 'send_message' || command === 'create_agent')) {
                const agentId = payload.agent_id || (payload.id || '');
                
                if (agentId) {
                    try {
                        // Get learning context for this agent
                        const learningContext = await this._learningSystem.getAgentLearningContext(agentId);
                        
                        // For send_message, add learning context to metadata
                        if (command === 'send_message') {
                            enhancedPayload.metadata = {
                                ...(enhancedPayload.metadata || {}),
                                learning_context: learningContext
                            };
                            traceInfo(`Added learning context to agent ${agentId} message`);
                        }
                        
                        // For create_agent, add learning context to agent metadata
                        if (command === 'create_agent') {
                            enhancedPayload.metadata = {
                                ...(enhancedPayload.metadata || {}),
                                learning_context: learningContext
                            };
                            traceInfo(`Added learning context to agent ${agentId} creation`);
                        }
                    } catch (learningError) {
                        traceError('Error adding learning context:', learningError);
                        // Continue without learning context in case of error
                    }
                }
            }
            
            const request = {
                command,
                payload: enhancedPayload
            };
            
            traceInfo(`Sending request to CrewAI server: ${JSON.stringify(request)}`);
            
            // Send request to the server using a TCP socket
            const net = require('net');
            const port = await this._getServerPort();
            
            return new Promise((resolve, reject) => {
                const client = new net.Socket();
                
                // Set a connection timeout
                const connectionTimeout = setTimeout(() => {
                    client.destroy();
                    reject(new Error('Connection timeout: Could not connect to CrewAI server'));
                }, 5000);
                
                client.connect(port, 'localhost', () => {
                    // Connection successful, clear the timeout
                    clearTimeout(connectionTimeout);
                    
                    // Send the request
                    client.write(JSON.stringify(request) + '\n');
                });
                
                let data = '';
                client.on('data', (chunk: Buffer) => {
                    data += chunk.toString();
                    
                    // Check if we have a complete response
                    if (data.indexOf('\n') !== -1) {
                        // Parse the response
                        const response = JSON.parse(data.trim());
                        
                        // Close the connection
                        client.end();
                        
                        // Resolve the promise with the response
                        resolve(response);
                    }
                });
                
                client.on('error', (err: Error) => {
                    traceError(`Error communicating with CrewAI server: ${err}`);
                    clearTimeout(connectionTimeout);
                    client.destroy();
                    reject(err);
                });
                
                client.on('timeout', () => {
                    traceError('Timeout communicating with CrewAI server');
                    clearTimeout(connectionTimeout);
                    client.destroy();
                    reject(new Error('Timeout communicating with CrewAI server'));
                });
            });
        } catch (error) {
            traceError('Error sending request to CrewAI server:', error);
            throw error; // Propagate the error to be handled by the caller
        }
    }
    
    // No simulated behavior - we either connect to the real server or fail gracefully
    
    /**
     * Ensures the project structure is set up correctly for the CrewAI server
     * Creates the .tribe folder and necessary files if they don't exist
     * Avoids creating duplicate structures in subfolders
     * Handles migration of .tribe folders from subfolders to parent folders
     */
    private async _ensureProjectStructure(projectPath: string): Promise<void> {
        try {
            // Import the findAllProjectPaths function
            const { findAllProjectPaths } = await import('./utilities');
            
            // Find all project paths in the hierarchy
            const projectPaths = await findAllProjectPaths(projectPath);
            
            // Handle project hierarchy with potential migration
            let actualProjectPath = projectPath;
            let shouldMigrate = false;
            let sourceFolder: string | undefined;
            
            // Case 1: We have a .tribe in both current folder and a parent folder
            if (projectPaths.current && projectPaths.parent) {
                traceInfo(`Found .tribe folders in both current (${projectPaths.current}) and parent (${projectPaths.parent}) directories`);
                
                // If both exist, we should consolidate them, preferring the parent
                actualProjectPath = projectPaths.parent;
                sourceFolder = projectPaths.current;
                shouldMigrate = true;
                
                this._projectPath = projectPaths.parent;
            } 
            // Case 2: We only have a .tribe in parent directory
            else if (projectPaths.parent) {
                traceInfo(`Found existing project structure in parent directory: ${projectPaths.parent}`);
                actualProjectPath = projectPaths.parent;
                this._projectPath = projectPaths.parent;
            }
            // Case 3: We only have a .tribe in current directory
            else if (projectPaths.current) {
                actualProjectPath = projectPaths.current;
            }
            
            // Create .tribe folder
            const tribeFolderPath = path.join(actualProjectPath, TRIBE_FOLDER);
            await fs.ensureDir(tribeFolderPath);
            
            // Handle migration from subfolder if needed
            if (shouldMigrate && sourceFolder) {
                try {
                    const sourceTribePath = path.join(sourceFolder, TRIBE_FOLDER);
                    
                    // Only attempt migration if both folders exist
                    if (await fs.pathExists(sourceTribePath) && await fs.pathExists(tribeFolderPath)) {
                        traceInfo(`Migrating project data from ${sourceTribePath} to ${tribeFolderPath}`);
                        
                        // Merge project.json if both exist
                        const sourceProjectPath = path.join(sourceTribePath, 'project.json');
                        const targetProjectPath = path.join(tribeFolderPath, 'project.json');
                        
                        if (await fs.pathExists(sourceProjectPath)) {
                            try {
                                // Read source project data
                                const sourceData = await fs.readJson(sourceProjectPath);
                                
                                // Read target project data if exists
                                let targetData = {};
                                if (await fs.pathExists(targetProjectPath)) {
                                    targetData = await fs.readJson(targetProjectPath);
                                }
                                
                                // Merge project data, prioritizing existing target data
                                // But preserving important fields from the source
                                const mergedData = {
                                    ...targetData,
                                    // Only update vision if not already set in target
                                    vision: (targetData as any).vision || sourceData.vision,
                                    // Preserve subfolder project.json as subproject data
                                    subprojects: {
                                        ...(targetData as any).subprojects || {},
                                        [path.basename(sourceFolder)]: {
                                            path: sourceFolder,
                                            originalData: sourceData
                                        }
                                    },
                                    // Update last modified
                                    lastModified: new Date().toISOString()
                                };
                                
                                // Write merged data
                                await fs.writeJson(targetProjectPath, mergedData, { spaces: 2 });
                                traceInfo('Successfully merged project data');
                                
                                // Mark the source project.json as migrated
                                await fs.writeJson(sourceProjectPath, {
                                    ...sourceData,
                                    migrated: true,
                                    migratedTo: actualProjectPath,
                                    lastModified: new Date().toISOString()
                                }, { spaces: 2 });
                            } catch (mergeError) {
                                traceError('Error merging project data:', mergeError);
                                // Continue anyway to create default structure
                            }
                        }
                    }
                } catch (migrationError) {
                    traceError('Error during migration:', migrationError);
                    // Continue anyway to create default structure
                }
            }
            
            // Create necessary subfolders
            const subfolders = [
                'agents',     // Store agent metadata and state
                'tasks',      // Store task definitions and status
                'teams',      // Store team compositions and crew definitions
                'memory',     // Store agent memories and learning
                'context',    // Store project context and knowledge
                'logs',       // Store operation logs
                'cache'       // Store temporary files and cache
            ];
            
            // Create all subfolders
            for (const subfolder of subfolders) {
                await fs.ensureDir(path.join(tribeFolderPath, subfolder));
            }
            
            // Check if project.json exists, create if not
            const projectJsonPath = path.join(tribeFolderPath, 'project.json');
            if (!(await fs.pathExists(projectJsonPath))) {
                const projectData = {
                    name: path.basename(projectPath),
                    description: 'MightyDev Project',
                    createdAt: new Date().toISOString(),
                    lastModified: new Date().toISOString(),
                    state: 'structure_initialized',
                    initialized: false, // Important: This is false to show the initialization screen
                    userInitialized: false // Flag to track if user has gone through setup
                };
                
                await fs.writeJson(projectJsonPath, projectData, { spaces: 2 });
                traceInfo(`Created project.json at ${projectJsonPath}`);
            }
            
            // Create default index files for important folders
            const defaultFiles = [
                { path: 'agents/index.json', content: { agents: [] } },
                { path: 'tasks/index.json', content: { tasks: [] } },
                { path: 'teams/index.json', content: { teams: [] } },
                { path: 'memory/index.json', content: { memories: [] } }
            ];
            
            for (const file of defaultFiles) {
                const filePath = path.join(tribeFolderPath, file.path);
                if (!(await fs.pathExists(filePath))) {
                    await fs.writeJson(filePath, file.content, { spaces: 2 });
                    traceInfo(`Created ${file.path}`);
                }
            }
            
            // Create server_port.txt with default port if it doesn't exist
            const portFilePath = path.join(tribeFolderPath, 'server_port.txt');
            if (!(await fs.pathExists(portFilePath))) {
                await fs.writeFile(portFilePath, '9876', 'utf8');
                traceInfo(`Created server_port.txt at ${portFilePath}`);
            }
            
            traceInfo(`Project structure initialized at ${tribeFolderPath}`);
        } catch (error) {
            traceError('Error ensuring project structure:', error);
            // Continue anyway, as we might be able to use the server without the structure
        }
    }
    
    /**
     * Register a listener for server output
     * @param listener Function to call with each line of server output
     * @returns Function to unregister the listener
     */
    public onServerOutput(listener: (data: string) => void): () => void {
        this._outputListeners.push(listener);
        
        // Return a function to remove the listener
        return () => {
            const index = this._outputListeners.indexOf(listener);
            if (index !== -1) {
                this._outputListeners.splice(index, 1);
            }
        };
    }
    
    /**
     * Dispose method to clean up resources
     */
    public dispose(): void {
        this.stopServer();
    }
}