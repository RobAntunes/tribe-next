// CrewAI Extension Class
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { spawn, ChildProcess } from 'child_process';
import { EXTENSION_ROOT_DIR, CREWAI_MAIN_SCRIPT, TRIBE_FOLDER, CREWAI_VENV_PYTHON } from './constants';
import { traceError, traceInfo, traceDebug } from './log/logging';
import { getInterpreterDetails } from './python';

/**
 * CrewAI Extension class that extends the base CrewAI functionality
 * with dynamic agent creation, task assignment, and other features.
 */
export class CrewAIExtension {
    private _pythonProcess: ChildProcess | undefined;
    private _projectPath: string | undefined;
    private _pythonPath: string[] | undefined;
    
    constructor(private readonly _context: vscode.ExtensionContext) {
        // Initialize
    }
    
    /**
     * Start the CrewAI server
     */
    public async startServer(projectPath: string): Promise<boolean> {
        try {
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
                traceInfo(`CrewAI server: ${data.toString()}`);
            });
            
            // Handle stderr
            this._pythonProcess.stderr?.on('data', (data) => {
                traceError(`CrewAI server error: ${data.toString()}`);
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
            if (!this._projectPath) {
                throw new Error('Project path not set');
            }
            
            // Check if there's a port file
            const portFilePath = path.join(this._projectPath, TRIBE_FOLDER, 'server_port.txt');
            if (await fs.pathExists(portFilePath)) {
                const portStr = await fs.readFile(portFilePath, 'utf8');
                const port = parseInt(portStr.trim(), 10);
                if (!isNaN(port)) {
                    return port;
                }
            }
            
            // Default port if no port file
            return 9876;
        } catch (error) {
            traceError('Error getting server port:', error);
            return 9876; // Default port
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
            const request = {
                command,
                payload
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
     * Dispose method to clean up resources
     */
    public dispose(): void {
        this.stopServer();
    }
}