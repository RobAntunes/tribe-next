// MightyDev CrewPanelProvider
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { EXTENSION_ROOT_DIR, WEBVIEW_VIEWTYPE, WEBVIEW_TITLE, TRIBE_FOLDER } from './constants';
import { getNonce } from './utilities';
import { traceError, traceInfo, traceDebug } from './log/logging';

// Define types for the server responses
interface ServerResponse {
    status?: string;
    message?: string;
    id?: string;
    [key: string]: any;
}

interface ModelResponse extends ServerResponse {
    response?: string;
    agent_id?: string;
}

interface Agent {
    id: string;
    name: string;
    role: string;
    description: string;
    backstory: string;
    skills: string[];
    status: string;
    autonomyLevel: number;
    [key: string]: any;
}

interface Task {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    assignee: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: any;
}

interface TeamData {
    agents?: Array<{
        name: string;
        role: string;
        description: string;
        backstory: string;
        skills?: string[];
        autonomyLevel?: number;
        [key: string]: any;
    }>;
    tasks?: Array<{
        title: string;
        description: string;
        priority?: string;
        assignee?: string;
        [key: string]: any;
    }>;
    summary?: string;
    [key: string]: any;
}

/**
 * Manages Tribe Panel webview view
 */
export class CrewPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = WEBVIEW_VIEWTYPE;
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _projectPath?: string;
    private _initialized: boolean = false;
    private _agents: any[] = [];
    private _tasks: any[] = [];
    private _pendingDecisions: any[] = [];
    private _notifications: any[] = [];
    private _activeAgents: any[] = [];
    private _currentPhase: string = '';
    private _projectVision: string = '';

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _workspaceRoot: string | undefined
    ) {
        this._extensionUri = _context.extensionUri;
        this._projectPath = _workspaceRoot;
        
        // Find the root project path and update _projectPath
        this._findRootProjectPath().then(() => {
            // Load persisted state if it exists
            this._loadState();
            
            // Load project vision from project.json if available
            this._loadProjectVision();
        });
    }
    
    /**
     * Find the root project path and update _projectPath
     */
    private async _findRootProjectPath(): Promise<void> {
        if (!this._workspaceRoot) {
            return;
        }
        
        try {
            // Import the findRootProjectPath function
            const { findRootProjectPath } = await import('./utilities');
            
            // Find the root project path
            const rootPath = await findRootProjectPath(this._workspaceRoot);
            if (rootPath !== this._workspaceRoot) {
                traceInfo(`Found root project path: ${rootPath}`);
                this._projectPath = rootPath;
            }
        } catch (error) {
            traceError('Error finding root project path:', error);
        }
    }
    
    /**
     * Load project vision from project.json
     */
    private async _loadProjectVision(): Promise<void> {
        if (!this._projectPath) {
            return;
        }
        
        try {
            // Import the getProjectVision function
            const { getProjectVision } = await import('./utilities');
            
            // Get the project vision
            const vision = await getProjectVision(this._projectPath);
            if (vision) {
                this._projectVision = vision;
                traceInfo(`Loaded project vision: ${vision.substring(0, 50)}...`);
            }
        } catch (error) {
            traceError('Error loading project vision:', error);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Enable JavaScript in the webview
            enableScripts: true,
            // Restrict the webview to only load resources from the extension's directory
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            traceDebug(`Received message: ${JSON.stringify(message)}`);
            switch (message.type) {
                case 'WEBVIEW_READY':
                    this._sendProjectState();
                    break;
                case 'INITIALIZE_PROJECT':
                    await this._initializeProject(message.payload);
                    break;
                case 'SEND_MESSAGE':
                    await this._handleAgentMessage(message.payload);
                    break;
                case 'CREATE_TEAM':
                case 'createTeam':
                    await this._createTeam(message.payload);
                    break;
                case 'ADD_AGENT':
                    await this._addAgent(message.payload);
                    break;
                case 'ACTIVATE_AGENT':
                    await this._activateAgent(message.payload.agentId);
                    break;
                case 'DEACTIVATE_AGENT':
                    await this._deactivateAgent(message.payload.agentId);
                    break;
                case 'ADD_TASK':
                    await this._addTask(message.payload.task);
                    break;
                case 'UPDATE_TASK':
                    await this._updateTask(message.payload.taskId, message.payload.updates);
                    break;
                case 'ADD_DECISION':
                    await this._addDecision(message.payload.decision);
                    break;
                case 'RESOLVE_DECISION':
                    await this._resolveDecision(message.payload.decisionId, message.payload.resolution);
                    break;
                case 'TOGGLE_LEARNING_SYSTEM':
                    await this._toggleLearningSystem(message.payload.enabled);
                    break;
                case 'APPLY_CODE':
                    await this._handleApplyCode(message.payload);
                    break;
                case 'PREVIEW_DIFF':
                    await this._handlePreviewDiff(message.payload);
                    break;
                case 'REACT_TO_MESSAGE':
                    await this._handleReactToMessage(message.payload);
                    break;
                case 'VIEW_THREAD':
                    await this._handleViewThread(message.payload);
                    break;
                case 'REPLY_TO_MESSAGE':
                    await this._handleReplyToMessage(message.payload);
                    break;
                case 'DOWNLOAD_FILE':
                    await this._handleDownloadFile(message.payload);
                    break;
                case 'RESET_TRIBE':
                    await this._resetTribe();
                    break;
                case 'COMMAND':
                    // Handle commands from UI components like the environment manager
                    try {
                        const result = await vscode.commands.executeCommand(message.command, message.payload);
                        this.postMessage({
                            type: 'COMMAND_RESULT',
                            command: message.command,
                            success: true,
                            result
                        });
                    } catch (error) {
                        traceError(`Error executing command ${message.command}:`, error);
                        this.postMessage({
                            type: 'COMMAND_RESULT',
                            command: message.command,
                            success: false,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                    break;
                case 'SHOW_INPUT_BOX':
                    // Handle input box requests 
                    try {
                        const input = await vscode.window.showInputBox({
                            prompt: message.payload?.prompt,
                            placeHolder: message.payload?.placeHolder,
                            value: message.payload?.value
                        });
                        
                        if (input) {
                            // If this is for creating a new .env file
                            if (message.payload?.prompt?.includes('.env')) {
                                // Get env files and add the new one
                                const envFilesResult = await vscode.commands.executeCommand('mightydev.getEnvFiles') as {envFiles?: {path: string, exists: boolean}[]};
                                const envFiles = envFilesResult?.envFiles || [];
                                
                                // Check if file already exists
                                const exists = envFiles.some((f) => f.path === input);
                                
                                if (!exists) {
                                    // Add new file to the list
                                    envFiles.push({
                                        path: input,
                                        exists: false
                                    });
                                    
                                    // Send updated list back to client
                                    this.postMessage({
                                        type: 'COMMAND_RESULT',
                                        command: 'mightydev.getEnvFiles',
                                        success: true,
                                        result: { envFiles }
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        traceError('Error showing input box:', error);
                    }
                    break;
                case 'RESET_STORAGE':
                    await this._resetTribe();
                    break;
                case 'RESTART_EXTENSION':
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                    break;
                case 'EXECUTE_TOOL':
                    try {
                        const { toolName, params } = message.payload;
                        traceInfo(`Executing tool: ${toolName} with params: ${JSON.stringify(params)}`);
                        
                        const result = await vscode.commands.executeCommand('mightydev.executeAgentTool', toolName, params);
                        
                        this.postMessage({
                            type: 'EXECUTE_TOOL_RESULT',
                            toolName,
                            success: true,
                            result
                        });
                    } catch (error) {
                        traceError(`Error executing tool: ${error}`);
                        this.postMessage({
                            type: 'EXECUTE_TOOL_RESULT',
                            toolName: message.payload?.toolName,
                            success: false,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                    break;
                default:
                    traceInfo(`Unhandled message type: ${message.type}`);
            }
        });

        // Send current state to webview
        this._sendProjectState();
    }

    /**
     * Posts a message to the webview
     */
    public postMessage(message: any): void {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    /**
     * Resets the Tribe state
     */
    private async _resetTribe(): Promise<void> {
        this._initialized = false;
        this._agents = [];
        this._tasks = [];
        this._pendingDecisions = [];
        this._notifications = [];
        this._activeAgents = [];
        this._currentPhase = '';
        this._projectVision = '';
        this._messages = []; // Clear messages too

        // Clear persisted state if it exists
        if (this._projectPath) {
            const tribeFolderPath = path.join(this._projectPath, TRIBE_FOLDER);
            if (await fs.pathExists(tribeFolderPath)) {
                await fs.remove(tribeFolderPath);
            }
        }

        // Send updated state to webview
        this._sendProjectState();

        // Show notification
        vscode.window.showInformationMessage('Tribe has been reset.');
    }

    /**
     * Initializes a new project
     */
    private async _initializeProject(projectData: any): Promise<void> {
        traceInfo('Initializing project with data: ', projectData);
        
        try {
            // First, find the root project path to avoid duplicate .tribe folders
            await this._findRootProjectPath();
            
            // Create .tribe folder if it doesn't exist
            if (this._projectPath) {
                const tribeFolderPath = path.join(this._projectPath, TRIBE_FOLDER);
                await fs.ensureDir(tribeFolderPath);
                
                // Save project data
                const projectFilePath = path.join(tribeFolderPath, 'project.json');
                
                // Read existing file if it exists to preserve any other fields
                let projectJson = {};
                try {
                    if (await fs.pathExists(projectFilePath)) {
                        projectJson = await fs.readJson(projectFilePath);
                    }
                } catch (readError) {
                    traceError('Error reading existing project.json:', readError);
                    // Continue with empty object
                }
                
                // Update with new values
                await fs.writeJson(projectFilePath, {
                    ...projectJson,
                    vision: projectData.description,
                    initialized: true,
                    userInitialized: true, // This is the new flag to indicate user initialization
                    state: 'initialized',
                    lastModified: new Date().toISOString(),
                    createdAt: (projectJson as any).createdAt || new Date().toISOString()
                }, { spaces: 2 });
            }
            
            // Set up initial project state
            this._initialized = true;
            this._projectVision = projectData.description;
            this._currentPhase = 'Planning';
            
            // Send updated state to webview
            this._sendProjectState();
            
            // Notify webview that project is initialized
            this.postMessage({
                type: 'PROJECT_INITIALIZED',
                payload: {
                    vision: this._projectVision,
                    currentPhase: this._currentPhase
                }
            });
            
            // Check if we need to set up API keys first
            const apiKeysSet = await this._checkForApiKeys?.() || false;
            if (!apiKeysSet) {
                // Show a dialog asking the user to set up API keys
                vscode.window.showInformationMessage(
                    'API keys are required to use the AI features. Would you like to set them up now?',
                    'Set Up API Keys', 'Later'
                ).then(selection => {
                    if (selection === 'Set Up API Keys') {
                        vscode.commands.executeCommand('mightydev.openEnvManager');
                    }
                });
                
                // Send message to the user
                this.postMessage({
                    type: 'AGENT_MESSAGE',
                    payload: {
                        id: `msg-${Date.now()}`,
                        sender: 'system',
                        content: 'Please set up your API keys in the Environment Manager to enable AI features.',
                        timestamp: new Date().toISOString(),
                        type: 'system',
                        status: 'error'
                    }
                });
                
                return;
            }
            
            // Use CrewAI to create the optimal team for this project
            try {
                // First, communicate with CrewAI extension to initialize the project
                await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'create_crew', {
                    description: projectData.description
                });
                
                // Then create the recruitment team
                await this._createRecruitmentTeam(projectData.description);
            } catch (error) {
                traceError('Failed to initialize CrewAI:', error);
                
                // Determine error type
                const errorMessage = error instanceof Error ? error.message : String(error);
                let errorType = 'server';
                
                // Check for API key issues
                if (errorMessage.includes('API_KEY_MISSING') || 
                    errorMessage.includes('API key') || 
                    errorMessage.includes('api key')) {
                    errorType = 'api_key';
                    
                    // Send error to webview with option to open env manager
                    this.postMessage({
                        type: 'SERVER_ERROR',
                        payload: {
                            message: 'Missing API key. Please configure your API keys in the Environment Manager.',
                            canRetry: true,
                            action: 'OPEN_ENV_MANAGER',
                            actionPayload: {},
                            errorType: 'api_key'
                        }
                    });
                    
                    return;
                }
                // Check for dependency issues
                else if (errorMessage.includes('ModuleNotFound') || 
                         errorMessage.includes('No module named') ||
                         errorMessage.includes('import error')) {
                    errorType = 'dependency';
                }
                
                // Send error to webview
                this.postMessage({
                    type: 'SERVER_ERROR',
                    payload: {
                        message: `Could not connect to CrewAI server: ${errorMessage}`,
                        canRetry: true,
                        action: 'INITIALIZE_PROJECT',
                        actionPayload: projectData,
                        errorType
                    }
                });
                
                // Show error message to user
                vscode.window.showErrorMessage(
                    `Failed to connect to CrewAI server. Check that Python dependencies are installed and try again.`,
                    'Retry'
                ).then(selection => {
                    if (selection === 'Retry') {
                        this._initializeProject(projectData);
                    }
                });
            }
            
        } catch (error) {
            traceError('Failed to initialize project:', error);
            vscode.window.showErrorMessage(`Failed to initialize project: ${error}`);
            
            // Send error to webview
            this.postMessage({
                type: 'SERVER_ERROR',
                payload: {
                    message: `Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`,
                    canRetry: true,
                    action: 'INITIALIZE_PROJECT',
                    actionPayload: projectData
                }
            });
        }
    }

    /**
     * Creates the initial recruitment team
     */
    private async _createRecruitmentTeam(projectDescription: string): Promise<void> {
        // Check if we have a project path
        if (!this._workspaceRoot) {
            traceError('Cannot create recruitment team: No workspace root available');
            throw new Error('No workspace root available');
        }
        
        // Update CrewAI extension with the project path before making any requests
        try {
            await vscode.commands.executeCommand('mightydev.startCrewAIServer', this._workspaceRoot);
        } catch (error) {
            traceError('Error starting CrewAI server before team creation:', error);
            // Continue anyway, the server might already be running
        }
        
        // Create the actual recruitment agent
        const recruiter = {
            id: 'recruiter-1',
            name: 'Trinity',
            role: 'Senior Recruitment Agent',
            description: 'Expert at analyzing project requirements and assembling the optimal team.',
            backstory: 'With years of experience in talent acquisition for complex software projects, Trinity excels at matching skills to project needs.',
            skills: ['team building', 'requirement analysis', 'talent assessment'],
            status: 'active',
            autonomyLevel: 0.8
        };
        
        // Add the agent
        this._agents.push(recruiter);
        this._activeAgents.push(recruiter);
        
        // Register the agent with CrewAI server
        try {
            await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'create_agent', {
                id: 'recruiter-1',
                name: 'Trinity',
                role: 'Senior Recruitment Agent',
                goal: 'Assemble the perfect team for the project by analyzing requirements and matching skills',
                backstory: 'With years of experience in talent acquisition for complex software projects, Trinity excels at matching skills to project needs.',
                allow_delegation: false
            });
            traceInfo(`Successfully registered recruiter agent with CrewAI server`);
        } catch (error) {
            traceError('Error registering agent with CrewAI server:', error);
            // Continue anyway, as we'll try another approach if this fails
        }
        
        // Notify the webview
        this.postMessage({
            type: 'NEW_AGENT_ADDED',
            payload: {
                agent: recruiter,
                active: true
            }
        });
        
        // Create a loading message from the recruitment agent
        const loadingMessageId = `msg-${Date.now()}`;
        this.postMessage({
            type: 'AGENT_MESSAGE',
            payload: {
                id: loadingMessageId,
                sender: 'recruiter-1',
                content: `I'm analyzing your project description: "${projectDescription}"\n\nI'll assemble the optimal team for this project. This may take a few moments...`,
                timestamp: new Date().toISOString(),
                type: 'agent',
                status: 'loading'
            }
        });
        
        // Try to create the team with the foundation model
        await this._createTeamWithFoundationModel(projectDescription, loadingMessageId);
    }

    /**
     * Checks if API keys are set
     */
    private async _checkForApiKeys(): Promise<boolean> {
        try {
            if (!this._projectPath) {
                return false;
            }
            
            // Check multiple locations for API keys
            const envFileLocations = [
                // Project .tribe/.env
                path.join(this._projectPath, TRIBE_FOLDER, '.env'),
                // Project .env
                path.join(this._projectPath, '.env'),
                // Extension root .env
                path.join(EXTENSION_ROOT_DIR, '.env'),
                // Home directory .env
                path.join(os.homedir(), '.env'),
            ];
            
            for (const envFile of envFileLocations) {
                if (await fs.pathExists(envFile)) {
                    try {
                        const content = await fs.readFile(envFile, 'utf8');
                        
                        if (content.includes('ANTHROPIC_API_KEY=') || content.includes('OPENAI_API_KEY=')) {
                            // Found at least one API key
                            return true;
                        }
                    } catch {
                        // Ignore read errors
                    }
                }
            }
            
            // Check environment variables
            if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
                return true;
            }
            
            return false;
        } catch (error) {
            traceError('Error checking for API keys:', error);
            return false;
        }
    }
    
    /**
     * Creates a team using the foundation model's analysis
     */
    private async _createTeamWithFoundationModel(projectDescription: string, loadingMessageId: string): Promise<void> {
        try {
            // First tell the CrewAI server to create a crew (this ensures the server is initialized)
            const serverResponse = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'create_team', {
                description: projectDescription
            }) as ServerResponse;
            
            // Check if the server returned an error
            if (serverResponse && serverResponse.status === 'error') {
                // If it's an API key issue, show specific message
                if (serverResponse.message && 
                    (serverResponse.message.includes('API_KEY_MISSING') || 
                     serverResponse.message.includes('API key') ||
                     serverResponse.message.includes('api key'))) {
                    
                    // Send error to webview with option to open env manager
                    this.postMessage({
                        type: 'SERVER_ERROR',
                        payload: {
                            message: 'Missing API key. Please configure your API keys in the Environment Manager.',
                            canRetry: true,
                            action: 'OPEN_ENV_MANAGER',
                            actionPayload: {},
                            errorType: 'api_key'
                        }
                    });
                    
                    // Update the loading message
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: 'I cannot continue without API keys. Please configure your API keys in the Environment Manager and try again.',
                            status: 'error'
                        }
                    });
                    
                    return;
                }
                
                // For other errors, throw to be caught by the general handler
                throw new Error(serverResponse.message || 'Server error creating team');
            }
            
            // Prepare the prompt to generate the team - based on CLAUDE.md spec
            const teamPrompt = `
            Analyze the following project description for an AI-native IDE and create an optimal team of AI agents to implement it:
            "${projectDescription}"
            
            As specified in our project documents, we need character-like agents with detailed descriptions and metadata
            for UI presentation to give each agent a unique feel and personality.
            
            Create 4-6 agents with the following information for each:
            1. A memorable character-like name (e.g., "Sparks", "Nova", "Trinity")
            2. Specific role (e.g., "Senior Data Scientist", "Lead Architect", "UI/UX Designer")
            3. Clear goal statement (1 sentence about what they aim to achieve)
            4. Detailed description (2-3 sentences about their expertise and approach)
            5. Rich backstory (3-4 sentences that explains their expertise and personality)
            6. Comprehensive skills list (5-8 relevant technical and soft skills)
            7. Stylistic properties (communication style, quirks, working preferences)
            8. Autonomy level (float between 0.0-1.0, higher for more autonomous roles)
            
            IMPORTANT GUIDELINES FROM PROJECT SPEC:
            - Focus on stylistic properties rather than variable skill levels
            - Include communication style, learning style, working style, quirks, traits
            - These agents will dynamically generate additional agents, tasks, and tools at runtime
            - The project makes extensive use of CrewAI for dynamic agentic environments
            
            IMPORTANT: You MUST use the structured_json_output tool to format your response. Structure your output exactly as follows:
            {
              "agents": [
                {
                  "name": "character name",
                  "role": "specific role title",
                  "goal": "clear goal statement",
                  "description": "detailed description",
                  "backstory": "rich backstory with personality",
                  "skills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
                  "communicationStyle": "description of how they communicate",
                  "workingStyle": "description of how they approach work",
                  "quirks": ["interesting trait 1", "interesting trait 2"],
                  "autonomyLevel": 0.8
                },
                ...
              ],
              "tasks": [
                {
                  "title": "task title",
                  "description": "detailed task description",
                  "priority": "high/medium/low",
                  "assignee": "name of the agent this task is assigned to"
                },
                ...
              ],
              "summary": "Comprehensive plan for phase 1 implementation of the project"
            }
            
            Include 4-7 initial tasks that implement the first phase of the project, with detailed descriptions.
            Make sure the team includes diverse expertise including architecture, UI/UX, agent development, 
            and systems integration to build this AI-native IDE using CrewAI.
            
            YOU MUST USE THE STRUCTURED_JSON_OUTPUT TOOL TO ENSURE YOUR RESPONSE IS PROPERLY FORMATTED.
            
            DO NOT RETURN TEXT CONTENT. ONLY USE THE structured_json_output TOOL.
            `;
            
            // For storing the team data
            let teamData: TeamData | undefined;
            let usedFallbackTeam = false;
            
            // Try different approaches in sequence to create the team, starting with the most robust
            const createTeamApproaches = [
                // 1. Primary approach: Use registered recruiter agent
                async (): Promise<ModelResponse> => {
                    traceInfo('Attempting to create team using registered recruiter agent');
                    return await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'send_message', {
                        message: teamPrompt,
                        agent_id: 'recruiter-1'
                    }) as ModelResponse;
                },
                
                // 2. Fallback: Basic model request without specifying agent
                async (): Promise<ModelResponse> => {
                    traceInfo('Recruiter agent not found, trying with basic model request');
                    return await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'send_message', {
                        message: teamPrompt
                    }) as ModelResponse;
                },
                
                // 3. Last resort: Create a new temporary agent and try with that
                async (): Promise<ModelResponse> => {
                    traceInfo('Creating temporary agent for team creation');
                    await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'create_agent', {
                        id: 'temp-recruiter',
                        name: 'Temporary Recruiter',
                        role: 'Team Creation Specialist',
                        goal: 'Create an optimal team for the project',
                        backstory: 'A specialist in analyzing project requirements and assembling teams.',
                        allow_delegation: false
                    });
                    
                    return await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'send_message', {
                        message: teamPrompt,
                        agent_id: 'temp-recruiter'
                    }) as ModelResponse;
                }
            ];
            
            // Try each approach until one succeeds or all fail
            let modelResponse: ModelResponse | undefined;
            let lastError: Error | undefined;
            
            for (const approach of createTeamApproaches) {
                try {
                    // Update loading message to show progress
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: `Analyzing your project requirements and creating a tailored team... This may take a moment.`,
                            status: 'loading'
                        }
                    });
                    
                    modelResponse = await approach();
                    if (modelResponse && modelResponse.status !== 'error') {
                        break; // Success! Break out of the loop
                    }
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    traceError(`Team creation approach failed:`, error);
                    // Continue to next approach
                }
            }
            
            // Check if we got a valid model response from any approach
            if (!modelResponse || modelResponse.status === 'error') {
                // Handle API key issues specially
                if (modelResponse && modelResponse.message && 
                    (modelResponse.message.includes('API_KEY_MISSING') || 
                     modelResponse.message.includes('API key') ||
                     modelResponse.message.includes('api key'))) {
                    
                    // Send error to webview with option to open env manager
                    this.postMessage({
                        type: 'SERVER_ERROR',
                        payload: {
                            message: 'Missing API key. Please configure your API keys in the Environment Manager.',
                            canRetry: true,
                            action: 'OPEN_ENV_MANAGER',
                            actionPayload: {},
                            errorType: 'api_key'
                        }
                    });
                    
                    // Update the loading message
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: 'I cannot continue without API keys. Please configure your API keys in the Environment Manager and try again.',
                            status: 'error'
                        }
                    });
                    
                    return;
                }
                
                // Before falling back to hardcoded team, try network connectivity check
                const networkConnectivity = await this._checkNetworkConnectivity();
                
                if (!networkConnectivity) {
                    traceInfo('Network connectivity issue detected. Using fallback team.');
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: `Unable to connect to AI services. Working in offline mode with a default team setup. Reconnect to the internet for full functionality.`,
                            status: 'loading'
                        }
                    });
                } else {
                    traceInfo('Network is available but all team creation approaches failed. Using fallback team as last resort.');
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: `I'm experiencing difficulties with the AI service. Creating a default team to get you started while I diagnose the issue.`,
                            status: 'loading'
                        }
                    });
                }
                
                // Use a hardcoded fallback team as a last resort
                try {
                    // Create a fallback team data structure
                    const fallbackTeamData: TeamData = {
                        agents: [
                            {
                                name: "Nova",
                                role: "Lead Architect",
                                goal: "Design a scalable and flexible architecture for the AI-native IDE",
                                description: "Expert in system architecture with a focus on AI integration. Specializes in designing systems that can evolve and scale with emerging technologies.",
                                backstory: "Nova began her career as a game engine developer before transitioning to AI systems. She has led architecture for three major IDE platforms and believes strongly in adaptive, self-improving systems. Her approach combines academic rigor with practical engineering.",
                                skills: ["system design", "CrewAI", "distributed systems", "API design", "agent architecture", "VSCode extension development", "Python", "TypeScript"],
                                communicationStyle: "Clear and concise with visual diagrams",
                                workingStyle: "Systematic and thorough with a focus on future-proofing",
                                quirks: ["Always relates systems to space metaphors", "Begins explanations with 'Imagine a constellation where...'"],
                                autonomyLevel: 0.9
                            },
                            {
                                name: "Sparks",
                                role: "Agent Development Specialist",
                                goal: "Create intelligent, collaborative AI agents that can work together seamlessly",
                                description: "AI agent programmer with deep expertise in LLM behavior and CrewAI framework. Known for building agents that communicate effectively and have distinct, useful personalities.",
                                backstory: "Sparks discovered his talent for AI while creating chatbots for customer service. After completing his Ph.D. in multi-agent systems, he joined a research lab focusing on emergent intelligence. He's passionate about creating AI with character and purpose.",
                                skills: ["LLM optimization", "agent design", "CrewAI framework", "prompt engineering", "Python", "collaborative systems", "behavioral modeling"],
                                communicationStyle: "Enthusiastic and metaphor-rich",
                                workingStyle: "Iterative prototyping with frequent testing",
                                quirks: ["Names all agents after mythological figures", "Speaks of models as if they have feelings"],
                                autonomyLevel: 0.8
                            },
                            {
                                name: "Echo",
                                role: "UI/UX Designer",
                                goal: "Create intuitive, efficient interfaces for complex agent interactions",
                                description: "Human-computer interaction expert specializing in AI interfaces. Creates designs that make complex AI systems accessible and intuitive for users of all technical levels.",
                                backstory: "Echo started in game design before focusing on productivity tools. She has designed interfaces for three major AI platforms and holds patents for novel interaction paradigms. She believes good design should feel invisible and make complex tasks simple.",
                                skills: ["UI design", "user research", "interaction design", "visual design", "prototyping", "accessibility", "React", "CSS"],
                                communicationStyle: "Visual with frequent mockups and examples",
                                workingStyle: "User-centered with iterative feedback loops",
                                quirks: ["Sketches interfaces during conversations", "Always asks 'but how would a new user feel?'"],
                                autonomyLevel: 0.7
                            },
                            {
                                name: "Cipher",
                                role: "Systems Integration Specialist",
                                goal: "Ensure seamless integration between all components of the IDE ecosystem",
                                description: "Expert in connecting disparate systems and ensuring data flows correctly. Specializes in making complex systems work together efficiently without bottlenecks or conflicts.",
                                backstory: "Cipher began as a network engineer before moving to systems architecture. He's known for solving seemingly impossible integration challenges on three major enterprise platforms. His methodical approach breaks down complex problems into manageable pieces.",
                                skills: ["API integration", "system architecture", "debugging", "performance optimization", "TypeScript", "Python", "VSCode extension API", "Git workflows"],
                                communicationStyle: "Logical and sequential with detailed diagrams",
                                workingStyle: "Methodical and thorough with comprehensive testing",
                                quirks: ["Uses lock and key metaphors constantly", "Names every component after cryptographic algorithms"],
                                autonomyLevel: 0.8
                            }
                        ],
                        tasks: [
                            {
                                title: "Create initial extension architecture",
                                description: "Design the core architecture for the VSCode extension, including how it will integrate with CrewAI and manage agent creation and communication.",
                                priority: "high",
                                assignee: "Nova"
                            },
                            {
                                title: "Implement agent bootstrapping system",
                                description: "Create the system that dynamically generates and manages AI agents based on project requirements and user input.",
                                priority: "high",
                                assignee: "Sparks"
                            },
                            {
                                title: "Design agent interaction UI",
                                description: "Create the interface for users to interact with AI agents, view their status, and manage their tasks and collaboration.",
                                priority: "medium",
                                assignee: "Echo"
                            },
                            {
                                title: "Implement CrewAI integration layer",
                                description: "Build the integration layer between VSCode extension APIs and the CrewAI framework to enable agent communication and task execution.",
                                priority: "high",
                                assignee: "Cipher"
                            },
                            {
                                title: "Create project initialization workflow",
                                description: "Implement the workflow for setting up a new project, analyzing requirements, and creating the initial team of AI agents.",
                                priority: "medium",
                                assignee: "Sparks"
                            }
                        ],
                        summary: "The initial phase will focus on creating the core architecture and integration with CrewAI, implementing agent bootstrapping, designing the interface for agent interaction, and establishing the project initialization workflow. This will provide the foundation for a fully functional AI-native IDE where agents can collaborate with the user and each other."
                    };
                    
                    // Use this fallback team instead of parsing the model response
                    teamData = fallbackTeamData;
                    usedFallbackTeam = true;
                } catch (fallbackError) {
                    traceError('Error creating fallback team:', fallbackError);
                    throw new Error(`Failed to generate team: ${modelResponse?.message || lastError?.message || 'Could not create team using any available method'}`);
                }
            }
            
            // Extract the JSON from the response if we have a model response and don't already have teamData
            if (!teamData && modelResponse && modelResponse.response) {
                try {
                    // Find JSON in the response text
                    const response = modelResponse.response;
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    
                    if (jsonMatch) {
                        teamData = JSON.parse(jsonMatch[0]) as TeamData;
                    } else {
                        // Handle non-JSON responses - try more aggressive parsing
                        try {
                            traceInfo('No JSON block detected, trying to extract structured data from text response');
                            const responseLines = response.split('\n');
                            const jsonStart = responseLines.findIndex(line => line.trim().startsWith('{'));
                            const jsonEnd = responseLines.findIndex(line => line.trim().endsWith('}'));
                            
                            if (jsonStart >= 0 && jsonEnd >= 0 && jsonEnd > jsonStart) {
                                const jsonText = responseLines.slice(jsonStart, jsonEnd + 1).join('\n');
                                teamData = JSON.parse(jsonText) as TeamData;
                            } else {
                                throw new Error('Could not find valid JSON structure in model response');
                            }
                        } catch (error) {
                            traceError('Error with advanced JSON extraction:', error);
                            throw new Error('Could not find valid JSON in model response');
                        }
                    }
                } catch (jsonError) {
                    traceError('Error parsing foundation model response:', jsonError);
                    traceError('Raw response:', modelResponse.response);
                    
                    // Make multiple attempts with different parsing strategies
                    const parsingStrategies = [
                        // Strategy 1: Look for content within triple backticks
                        (text: string) => {
                            const codeBlockMatch = text.match(/```(?:json)?([\s\S]*?)```/);
                            if (codeBlockMatch && codeBlockMatch[1]) {
                                return JSON.parse(codeBlockMatch[1].trim());
                            }
                            throw new Error('No JSON in code blocks');
                        },
                        
                        // Strategy 2: Try to find anything that looks like a JSON object
                        (text: string) => {
                            const jsonMatch = text.match(/{[\s\S]*}/);
                            if (jsonMatch) {
                                return JSON.parse(jsonMatch[0]);
                            }
                            throw new Error('No JSON-like patterns found');
                        },
                        
                        // Strategy 3: Try to extract JSON by relaxing parsing (replace quotes, fix commas)
                        (text: string) => {
                            // Replace smart quotes with regular quotes
                            let fixedText = text.replace(/[""]/g, '"');
                            // Fix trailing commas in arrays and objects
                            fixedText = fixedText.replace(/,(\s*[\]}])/g, '$1');
                            
                            const jsonMatch = fixedText.match(/{[\s\S]*}/);
                            if (jsonMatch) {
                                return JSON.parse(jsonMatch[0]);
                            }
                            throw new Error('No parseable JSON found after fixing quotes and commas');
                        },
                        
                        // Strategy 4: Use fallback hardcoded team if all else fails
                        (_: string) => {
                            traceInfo("Using fallback team data as last resort");
                            usedFallbackTeam = true;
                            return {
                                agents: [
                                    {
                                        name: "Nova",
                                        role: "Lead Architect",
                                        goal: "Design and implement the core architecture for the AI-native IDE",
                                        description: "Nova is a seasoned software architect specializing in AI systems. She excels at designing scalable architectures that support dynamic agent interactions.",
                                        backstory: "With a background in distributed systems and AI research, Nova has pioneered several innovative agent-based architectures. She's passionate about creating systems that are both powerful and intuitive.",
                                        skills: ["System Design", "Architecture Planning", "CrewAI Integration", "Python Development", "Agent Design", "Technical Leadership"],
                                        communicationStyle: "Clear and precise with a focus on technical accuracy",
                                        workingStyle: "Methodical and thorough, with careful consideration of all system implications",
                                        quirks: ["Uses architectural metaphors", "Visualizes systems as living organisms"],
                                        autonomyLevel: 0.9
                                    },
                                    {
                                        name: "Sparks",
                                        role: "Agent Developer",
                                        goal: "Create intelligent, adaptive AI agents that work together seamlessly",
                                        description: "Sparks specializes in developing AI agents with unique personalities and capabilities. He crafts agents that can solve complex problems through collaboration.",
                                        backstory: "A former game AI developer, Sparks discovered his passion for creating lifelike agent behaviors. He believes that giving agents distinct personalities makes them more effective problem-solvers.",
                                        skills: ["Agent Creation", "NLP", "Prompt Engineering", "Python", "CrewAI", "Behavioral Design"],
                                        communicationStyle: "Enthusiastic and imaginative, often anthropomorphizing the agents",
                                        workingStyle: "Iterative with rapid prototyping and constant refinement",
                                        quirks: ["Names all his agent prototypes", "Tests agents with creative scenarios"],
                                        autonomyLevel: 0.8
                                    },
                                    {
                                        name: "Trinity",
                                        role: "UI/UX Designer",
                                        goal: "Create an intuitive interface that makes AI agent interactions transparent and accessible",
                                        description: "Trinity designs interfaces that make complex AI interactions feel natural and intuitive. She bridges the gap between advanced AI capabilities and human-centered design.",
                                        backstory: "Trinity began her career designing interfaces for scientific applications before specializing in AI systems. She's driven by the challenge of making complex technologies accessible to all users.",
                                        skills: ["Interface Design", "User Experience", "Frontend Development", "Visual Design", "User Testing", "Accessibility"],
                                        communicationStyle: "Empathetic and user-focused, translating technical concepts into relatable terms",
                                        workingStyle: "Design-thinking approach with emphasis on user testing and iteration",
                                        quirks: ["Sketches interfaces on any available surface", "Creates personas for different user types"],
                                        autonomyLevel: 0.7
                                    },
                                    {
                                        name: "Nexus",
                                        role: "Systems Integrator",
                                        goal: "Ensure seamless integration between all components of the AI-native IDE",
                                        description: "Nexus specializes in connecting disparate systems into cohesive wholes. He ensures that all components of the IDE communicate effectively and efficiently.",
                                        backstory: "With experience in both frontend and backend development, Nexus developed a talent for seeing the big picture. He finds satisfaction in making complex systems work together harmoniously.",
                                        skills: ["System Integration", "API Development", "DevOps", "Testing", "Debugging", "Documentation"],
                                        communicationStyle: "Balanced and comprehensive, focusing on connections between components",
                                        workingStyle: "Systematic and thorough, with careful testing of all integration points",
                                        quirks: ["Uses network metaphors", "Creates elaborate integration diagrams"],
                                        autonomyLevel: 0.85
                                    }
                                ],
                                tasks: [
                                    {
                                        title: "Set up project foundation",
                                        description: "Initialize the project structure, set up the development environment, and configure the basic toolchain",
                                        priority: "high",
                                        assignee: "Nova"
                                    },
                                    {
                                        title: "Implement core CrewAI integration",
                                        description: "Develop the base integration with CrewAI to enable dynamic agent creation and management",
                                        priority: "high",
                                        assignee: "Sparks"
                                    },
                                    {
                                        title: "Design main UI components",
                                        description: "Create the key UI components for the IDE, including the agent interaction panel and task visualization system",
                                        priority: "medium",
                                        assignee: "Trinity"
                                    },
                                    {
                                        title: "Build API layer for agent communication",
                                        description: "Develop the API layer that will enable communication between the IDE, agents, and external tools",
                                        priority: "medium",
                                        assignee: "Nexus"
                                    },
                                    {
                                        title: "Implement agent bootstrapping process",
                                        description: "Create the initialization process that allows agents to generate additional agents based on project requirements",
                                        priority: "medium",
                                        assignee: "Sparks"
                                    }
                                ],
                                summary: "This team combines expertise in architecture, agent development, UI/UX, and systems integration to build the foundation of an AI-native IDE. The initial phase focuses on establishing the core infrastructure, CrewAI integration, and basic UI components to enable dynamic agent creation and management."
                            };
                        }
                    ];
                    
                    // Mark our fallback strategy for clarity
                    const fallbackStrategy = parsingStrategies[3];
                    Object.defineProperty(fallbackStrategy, 'strategyName', { value: 'fallbackData' });
                    
                    // Try each strategy until one works
                    for (const strategy of parsingStrategies) {
                        try {
                            teamData = strategy(modelResponse.response) as TeamData;
                            
                            // Validate the team data has the minimum required fields
                            if (teamData && 
                                Array.isArray(teamData.agents) && teamData.agents.length > 0 &&
                                Array.isArray(teamData.tasks) && teamData.tasks.length > 0) {
                                
                                traceInfo(`Successfully parsed team data using strategy: ${strategy.name || 'unnamed'}`);
                                break; // Exit the loop if we succeed with valid data
                            } else if ((strategy as any).strategyName === 'fallbackData') {
                                // This is the hardcoded fallback data which we know is valid
                                traceInfo(`Using fallback team data as last resort`);
                                break;
                            } else {
                                traceError(`Parsed data is missing required fields:`, teamData);
                                // Continue to next strategy as this didn't produce valid data
                            }
                        } catch (strategyError) {
                            traceError(`Parsing strategy failed:`, strategyError);
                            // Continue to next strategy
                        }
                    }
                    
                    // If we still don't have team data, give up
                    if (!teamData) {
                        throw new Error('Failed to parse team data from model response after multiple attempts');
                    }
                }
            }
            
            // Update the loading message with progress
            this.postMessage({
                type: 'AGENT_MESSAGE_UPDATE',
                payload: {
                    id: loadingMessageId,
                    content: `I've analyzed your project and determined the optimal team structure. Now creating the agents...`,
                    status: 'loading'
                }
            });
            
            // Make sure we have valid team data
            if (!teamData) {
                throw new Error('Failed to get valid team data');
            }
            
            // Process and add the generated agents
            if (teamData.agents && Array.isArray(teamData.agents)) {
                // Add the agents to our state
                for (let i = 0; i < teamData.agents.length; i++) {
                    const agentData = teamData.agents[i];
                    
                    // Create agent with generated data - include all fields from CLAUDE.md
                    const agent = {
                        id: `agent-${i + 1}`,
                        name: agentData.name,
                        role: agentData.role,
                        goal: agentData.goal || `Help implement the ${agentData.role} aspects of the project`,
                        description: agentData.description,
                        backstory: agentData.backstory,
                        skills: agentData.skills || [],
                        communicationStyle: agentData.communicationStyle || "Professional and clear",
                        workingStyle: agentData.workingStyle || "Methodical and thorough",
                        quirks: agentData.quirks || [],
                        status: 'active',
                        autonomyLevel: agentData.autonomyLevel || 0.8
                    };
                    
                    this._agents.push(agent);
                    this._activeAgents.push(agent);
                    
                    // Register each agent with CrewAI to ensure it's available for future interactions
                    // Only do this if we're not using the fallback team in offline mode
                    if (!usedFallbackTeam) {
                        try {
                            await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'create_agent', {
                                id: agent.id,
                                name: agent.name,
                                role: agent.role,
                                goal: agent.goal,
                                backstory: agent.backstory,
                                allow_delegation: false
                            });
                            traceInfo(`Successfully registered agent ${agent.name} with CrewAI server`);
                        } catch (registrationError) {
                            traceError(`Error registering agent ${agent.name} with CrewAI server:`, registrationError);
                            // Continue anyway, as we'll try to create the agent when needed
                        }
                    }
                    
                    // Notify the webview
                    this.postMessage({
                        type: 'NEW_AGENT_ADDED',
                        payload: {
                            agent,
                            active: true
                        }
                    });
                    
                    // Small delay between each agent for better UX
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Process and add the generated tasks
                if (teamData.tasks && Array.isArray(teamData.tasks)) {
                    for (let i = 0; i < teamData.tasks.length; i++) {
                        const taskData = teamData.tasks[i];
                        
                        // Find the agent ID by name
                        let assigneeId = 'agent-1'; // Default to first agent if no match
                        for (const agent of this._agents) {
                            if (agent.name === taskData.assignee || agent.role === taskData.assignee) {
                                assigneeId = agent.id;
                                break;
                            }
                        }
                        
                        // Create task with generated data
                        const task = {
                            id: `task-${i + 1}`,
                            title: taskData.title,
                            description: taskData.description,
                            status: i === 0 ? 'in_progress' : 'todo', // First task in progress, others todo
                            priority: taskData.priority || 'medium',
                            assignee: assigneeId,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        };
                        
                        this._tasks.push(task);
                        
                        // Notify the webview
                        this.postMessage({
                            type: 'NEW_TASK_ADDED',
                            payload: {
                                task
                            }
                        });
                    }
                }
                
                // Create a list of agent names and roles for the final message
                const agentList = teamData.agents.map((agent: any) => {
                    // Safely handle description which might be undefined
                    const shortDescription = agent.description 
                        ? agent.description.split('.')[0] 
                        : `${agent.role} specialist`;
                    return `* **${agent.name}** (${agent.role}) - ${shortDescription}`;
                }).join('\n');
                
                // Prepare final message content based on whether we used fallback team
                let finalMessageContent = '';
                if (usedFallbackTeam) {
                    finalMessageContent = `Due to ${!await this._checkNetworkConnectivity() ? 'network connectivity issues' : 'AI service limitations'}, I've created a default team for your project:\n\n${agentList}\n\n${teamData.summary || 'This team will help you get started with your project. When online connectivity is restored or AI services are available, you can reinitialize for a more tailored team.'}`; 
                } else {
                    finalMessageContent = `I've assembled a team tailored to your project requirements! The team includes:\n\n${agentList}\n\n${teamData.summary || 'The team is now ready to start working on your project. I\'ve also created some initial tasks to get things moving. You can interact with any team member directly or send messages to the entire team.'}`;
                }
                
                // Send final message from the recruiter with the team summary
                this.postMessage({
                    type: 'AGENT_MESSAGE_UPDATE',
                    payload: {
                        id: loadingMessageId,
                        content: finalMessageContent,
                        status: 'completed'
                    }
                });
                
                // If we created a temporary agent for team creation, clean it up
                if (modelResponse?.agent_id === 'temp-recruiter') {
                    try {
                        // Deactivate the temporary agent
                        this._deactivateAgent('temp-recruiter');
                    } catch (cleanupError) {
                        traceError('Error cleaning up temporary recruiter agent:', cleanupError);
                    }
                }
                
                // Deactivate the recruiter (dissolve after team creation)
                setTimeout(() => this._deactivateAgent('recruiter-1'), 2000);
                
                // Save the state
                this._saveState();
            } else {
                throw new Error('Invalid team data structure returned from model');
            }
            
        } catch (error) {
            traceError('Error in foundation model team creation:', error);
            
            // Determine error type
            const errorMessage = error instanceof Error ? error.message : String(error);
            let errorType = 'server';
            
            // Check for API key issues (this is a fallback, as these should be caught earlier)
            if (errorMessage.includes('API_KEY_MISSING') || 
                errorMessage.includes('API key') || 
                errorMessage.includes('api key')) {
                errorType = 'api_key';
            }
            // Check for dependency issues
            else if (errorMessage.includes('ModuleNotFound') || 
                     errorMessage.includes('No module named') ||
                     errorMessage.includes('import error')) {
                errorType = 'dependency';
            }
            // Check for network issues
            else if (errorMessage.includes('ECONNREFUSED') || 
                     errorMessage.includes('network') ||
                     errorMessage.includes('connection') ||
                     errorMessage.includes('timeout')) {
                errorType = 'network';
            }
            
            // Check if we have a network connectivity issue
            const isNetworkIssue = errorType === 'network' || 
                                  !(await this._checkNetworkConnectivity());
            
            // Update the loading message with a more specific error based on the error type
            let errorContent = '';
            if (isNetworkIssue) {
                errorContent = `Network connectivity issue detected. Please check your internet connection and try again.`;
            } else if (errorType === 'api_key') {
                errorContent = `API key configuration issue. Please set up your API keys in the Environment Manager.`;
            } else if (errorType === 'dependency') {
                errorContent = `Missing Python dependency. Please ensure CrewAI and required packages are installed.`;
            } else {
                errorContent = `Error creating your team: ${errorMessage}`;
            }
            
            this.postMessage({
                type: 'AGENT_MESSAGE_UPDATE',
                payload: {
                    id: loadingMessageId,
                    content: errorContent,
                    status: 'error'
                }
            });
            
            // Send error to webview with retry option and specific error type
            this.postMessage({
                type: 'SERVER_ERROR',
                payload: {
                    message: `Failed to create team: ${errorMessage}`,
                    canRetry: true,
                    action: 'INITIALIZE_PROJECT',
                    actionPayload: { description: projectDescription },
                    errorType: isNetworkIssue ? 'network' : errorType
                }
            });
        }
    }
    
    /**
     * Check network connectivity to detect if offline mode is needed
     */
    private async _checkNetworkConnectivity(): Promise<boolean> {
        try {
            // Execute a simple ping command to check connectivity
            // We check both anthropic.com and openai.com to ensure we can reach the API endpoints
            const pingResult = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'check_connectivity') as {status: string, online: boolean};
            
            return pingResult && pingResult.online === true;
        } catch (error) {
            traceError('Error checking network connectivity:', error);
            return false; // Assume offline if we can't check
        }
    }

    /**
     * Creates a new team
     */
    private async _createTeam(teamData: any): Promise<void> {
        // Redirect to project initialization for now
        await this._initializeProject(teamData);
    }

    /**
     * Adds a new agent
     */
    private async _addAgent(agentData: any): Promise<void> {
        try {
            // Generate a unique ID for the agent
            const agentId = `agent-${Date.now()}`;
            
            // Create the agent
            const agent = {
                id: agentId,
                ...agentData,
                status: 'active',
                autonomyLevel: 0.7
            };
            
            // Add to our state
            this._agents.push(agent);
            this._activeAgents.push(agent);
            
            // Notify the webview
            this.postMessage({
                type: 'NEW_AGENT_ADDED',
                payload: {
                    agent,
                    active: true
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to add agent:', error);
            vscode.window.showErrorMessage(`Failed to add agent: ${error}`);
        }
    }

    /**
     * Activates an agent
     */
    private async _activateAgent(agentId: string): Promise<void> {
        try {
            const agent = this._agents.find(a => a.id === agentId);
            if (agent && !this._activeAgents.some(a => a.id === agentId)) {
                this._activeAgents.push(agent);
                
                // Notify the webview
                this.postMessage({
                    type: 'AGENT_ACTIVATED',
                    payload: {
                        agentId
                    }
                });
                
                // Save state
                this._saveState();
            }
        } catch (error) {
            traceError('Failed to activate agent:', error);
            vscode.window.showErrorMessage(`Failed to activate agent: ${error}`);
        }
    }

    /**
     * Deactivates an agent
     */
    private async _deactivateAgent(agentId: string): Promise<void> {
        try {
            this._activeAgents = this._activeAgents.filter(a => a.id !== agentId);
            
            // Notify the webview
            this.postMessage({
                type: 'AGENT_DEACTIVATED',
                payload: {
                    agentId
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to deactivate agent:', error);
            vscode.window.showErrorMessage(`Failed to deactivate agent: ${error}`);
        }
    }

    /**
     * Adds a new task
     */
    private async _addTask(task: any): Promise<void> {
        try {
            // Generate a unique ID for the task
            const taskId = `task-${Date.now()}`;
            
            // Create the task
            const newTask = {
                id: taskId,
                ...task,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // Add to our state
            this._tasks.push(newTask);
            
            // Notify the webview
            this.postMessage({
                type: 'NEW_TASK_ADDED',
                payload: {
                    task: newTask
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to add task:', error);
            vscode.window.showErrorMessage(`Failed to add task: ${error}`);
        }
    }

    /**
     * Updates an existing task
     */
    private async _updateTask(taskId: string, updates: any): Promise<void> {
        try {
            // Find the task
            const taskIndex = this._tasks.findIndex(t => t.id === taskId);
            if (taskIndex < 0) {
                throw new Error(`Task with ID ${taskId} not found`);
            }
            
            // Update the task
            this._tasks[taskIndex] = {
                ...this._tasks[taskIndex],
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            // Notify the webview
            this.postMessage({
                type: 'TASK_UPDATED',
                payload: {
                    task: this._tasks[taskIndex]
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to update task:', error);
            vscode.window.showErrorMessage(`Failed to update task: ${error}`);
        }
    }

    /**
     * Adds a new decision
     */
    private async _addDecision(decision: any): Promise<void> {
        try {
            // Generate a unique ID for the decision
            const decisionId = `decision-${Date.now()}`;
            
            // Create the decision
            const newDecision = {
                id: decisionId,
                ...decision,
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // Add to our state
            this._pendingDecisions.push(newDecision);
            
            // Notify the webview
            this.postMessage({
                type: 'NEW_DECISION_ADDED',
                payload: {
                    decision: newDecision
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to add decision:', error);
            vscode.window.showErrorMessage(`Failed to add decision: ${error}`);
        }
    }

    /**
     * Resolves a pending decision
     */
    private async _resolveDecision(decisionId: string, resolution: any): Promise<void> {
        try {
            // Find the decision
            const decisionIndex = this._pendingDecisions.findIndex(d => d.id === decisionId);
            if (decisionIndex < 0) {
                throw new Error(`Decision with ID ${decisionId} not found`);
            }
            
            // Update the decision
            this._pendingDecisions[decisionIndex] = {
                ...this._pendingDecisions[decisionIndex],
                status: 'resolved',
                resolution,
                resolvedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // Notify the webview
            this.postMessage({
                type: 'DECISION_UPDATED',
                payload: {
                    decision: this._pendingDecisions[decisionIndex]
                }
            });
            
            // Save state
            this._saveState();
            
        } catch (error) {
            traceError('Failed to resolve decision:', error);
            vscode.window.showErrorMessage(`Failed to resolve decision: ${error}`);
        }
    }

    /**
     * Toggles the learning system
     */
    private async _toggleLearningSystem(enabled: boolean): Promise<void> {
        // In a full implementation, this would enable or disable the learning system
        // For now, we just notify the webview
        
        this.postMessage({
            type: 'LEARNING_SYSTEM_TOGGLED',
            payload: {
                enabled
            }
        });
    }
    
    /**
     * Handles applying code from chat to the editor
     */
    private async _handleApplyCode(payload: { code: string; language: string }): Promise<void> {
        try {
            // Extract code and language from payload
            const { code, language } = payload;
            
            if (!code) {
                throw new Error('No code provided to apply');
            }
            
            // Determine the language ID for the new document
            let languageId = 'plaintext';
            switch (language.toLowerCase()) {
                case 'js':
                case 'javascript':
                    languageId = 'javascript';
                    break;
                case 'ts':
                case 'typescript':
                    languageId = 'typescript';
                    break;
                case 'py':
                case 'python':
                    languageId = 'python';
                    break;
                case 'html':
                    languageId = 'html';
                    break;
                case 'css':
                    languageId = 'css';
                    break;
                case 'json':
                    languageId = 'json';
                    break;
                default:
                    // Try to use the provided language string directly if it's not one of the common ones
                    languageId = language || 'plaintext';
            }
            
            // Create and show a new text document with the code
            const document = await vscode.workspace.openTextDocument({
                content: code,
                language: languageId
            });
            
            await vscode.window.showTextDocument(document);
            
            // Show success message
            vscode.window.showInformationMessage('Code applied to new document');
            
        } catch (error) {
            traceError('Error applying code to editor:', error);
            vscode.window.showErrorMessage(`Failed to apply code: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Handles previewing diff of code from chat
     */
    private async _handlePreviewDiff(payload: { code: string; language: string }): Promise<void> {
        try {
            // Extract code and language from payload
            const { code, language } = payload;
            
            if (!code) {
                throw new Error('No code provided for diff preview');
            }
            
            // We need to get the active editor to generate a diff
            const activeEditor = vscode.window.activeTextEditor;
            
            if (!activeEditor) {
                // If no active editor, just open the code in a new document
                await this._handleApplyCode(payload);
                vscode.window.showInformationMessage('No active editor to compare with. Opened code in new document.');
                return;
            }
            
            // Get the document's content and language
            const existingCode = activeEditor.document.getText();
            const existingLanguage = activeEditor.document.languageId;
            
            // If languages don't match, warn the user
            if (language && language.toLowerCase() !== existingLanguage.toLowerCase()) {
                vscode.window.showWarningMessage(`Language mismatch: Comparing ${language} code with ${existingLanguage} file.`);
            }
            
            // Open a diff editor comparing the existing file with the generated code
            const uri = activeEditor.document.uri;
            
            // Create a temporary document with the generated code
            const tempFileUri = uri.with({ scheme: 'untitled', path: uri.path + '.generated' });
            
            // Create and open the temp document
            const tempDocument = await vscode.workspace.openTextDocument(tempFileUri);
            const tempEditor = await vscode.window.showTextDocument(tempDocument);
            
            // Insert the generated code
            await tempEditor.edit(editBuilder => {
                const fullRange = new vscode.Range(
                    tempDocument.positionAt(0),
                    tempDocument.positionAt(tempDocument.getText().length)
                );
                editBuilder.replace(fullRange, code);
            });
            
            // Open the diff editor
            await vscode.commands.executeCommand('vscode.diff', 
                uri, 
                tempFileUri, 
                `Current ↔ Generated (${uri.fsPath.split('/').pop()})`
            );
            
        } catch (error) {
            traceError('Error previewing code diff:', error);
            vscode.window.showErrorMessage(`Failed to preview diff: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Handles reacting to a message
     */
    private async _handleReactToMessage(payload: { messageId: string; emoji: string; userId?: string }): Promise<void> {
        try {
            // Extract messageId and emoji from payload
            const { messageId, emoji, userId } = payload;
            
            if (!messageId || !emoji) {
                throw new Error('Message ID and emoji are required');
            }
            
            // Load messages from storage
            await this._loadMessages();
            
            // Find the message in stored messages
            const messageIndex = this._messages.findIndex(m => m.id === messageId);
            if (messageIndex < 0) {
                throw new Error(`Message with ID ${messageId} not found`);
            }
            
            // Get the message
            const message = this._messages[messageIndex];
            
            // Initialize reactions array if it doesn't exist
            if (!message.reactions) {
                message.reactions = [];
            }
            
            // Find if this emoji reaction already exists
            const reactionIndex = message.reactions.findIndex((r: any) => r.emoji === emoji);
            
            // Determine the user ID
            const reactingUserId = userId || 'current-user';
            
            if (reactionIndex >= 0) {
                // Check if user already reacted with this emoji
                const userIndex = message.reactions[reactionIndex].users.indexOf(reactingUserId);
                
                if (userIndex >= 0) {
                    // User already reacted - remove the reaction
                    message.reactions[reactionIndex].users.splice(userIndex, 1);
                    message.reactions[reactionIndex].count--;
                    
                    // Remove the reaction completely if no users left
                    if (message.reactions[reactionIndex].count <= 0) {
                        message.reactions.splice(reactionIndex, 1);
                    }
                } else {
                    // Add user to existing reaction
                    message.reactions[reactionIndex].users.push(reactingUserId);
                    message.reactions[reactionIndex].count++;
                }
            } else {
                // Create a new reaction
                message.reactions.push({
                    emoji,
                    count: 1,
                    users: [reactingUserId]
                });
            }
            
            // Update the message in the array
            this._messages[messageIndex] = message;
            
            // Save updated messages
            await this._saveMessages();
            
            // Notify the webview about the reaction update
            this.postMessage({
                type: 'MESSAGE_REACTION_UPDATED',
                payload: {
                    messageId,
                    reactions: message.reactions
                }
            });
            
        } catch (error) {
            traceError('Error handling message reaction:', error);
            vscode.window.showErrorMessage(`Failed to add reaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Handles viewing a thread
     */
    private async _handleViewThread(payload: { threadId: string }): Promise<void> {
        try {
            // Extract threadId from payload
            const { threadId } = payload;
            
            if (!threadId) {
                throw new Error('Thread ID is required');
            }
            
            // Load messages from storage
            await this._loadMessages();
            
            // Find all messages in this thread
            const threadMessages = this._messages.filter(m => m.threadId === threadId);
            
            if (threadMessages.length === 0) {
                throw new Error(`Thread with ID ${threadId} not found`);
            }
            
            // Notify the webview about the thread
            this.postMessage({
                type: 'THREAD_VIEW',
                payload: {
                    threadId,
                    messages: threadMessages
                }
            });
            
        } catch (error) {
            traceError('Error loading thread:', error);
            vscode.window.showErrorMessage(`Failed to load thread: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Handles replying to a message
     */
    private async _handleReplyToMessage(payload: { 
        messageId: string; 
        content: string; 
        threadId?: string; 
        from?: string;
        to?: string;
    }): Promise<void> {
        try {
            // Extract data from payload
            const { messageId, content, threadId, from, to } = payload;
            
            if (!messageId || !content) {
                throw new Error('Message ID and content are required');
            }
            
            // Load messages from storage
            await this._loadMessages();
            
            // Find the parent message
            const parentMessage = this._messages.find(m => m.id === messageId);
            if (!parentMessage) {
                throw new Error(`Message with ID ${messageId} not found`);
            }
            
            // Determine thread ID - either from payload, parent message, or create new
            let replyThreadId = threadId || parentMessage.threadId;
            
            // If no thread exists yet, create one
            if (!replyThreadId) {
                replyThreadId = `thread-${Date.now()}`;
                
                // Update parent message with thread ID
                parentMessage.threadId = replyThreadId;
                
                // Save the updated parent message
                const parentIndex = this._messages.findIndex(m => m.id === messageId);
                if (parentIndex >= 0) {
                    this._messages[parentIndex] = parentMessage;
                }
            }
            
            // Create reply message
            const replyId = `msg-${Date.now()}`;
            const replyMessage = {
                id: replyId,
                sender: from || 'current-user',
                content,
                timestamp: new Date().toISOString(),
                type: from === 'current-user' ? 'user' : 'agent',
                targetAgent: to || parentMessage.sender,
                threadId: replyThreadId,
                parentId: messageId
            };
            
            // Add to messages
            this._messages.push(replyMessage);
            
            // Save updated messages
            await this._saveMessages();
            
            // Check if we need to send the message via CrewAI
            if (to && to !== 'current-user') {
                // Create a loading message for the agent response
                const loadingMessageId = `msg-${Date.now() + 1}`;
                
                // Add loading message to the UI
                this.postMessage({
                    type: 'AGENT_MESSAGE',
                    payload: {
                        id: loadingMessageId,
                        sender: to,
                        content: '...',
                        timestamp: new Date().toISOString(),
                        type: 'agent',
                        status: 'loading',
                        threadId: replyThreadId,
                        parentId: replyId
                    }
                });
                
                // Send message to agent in the background
                this._handleAgentMessage({
                    content,
                    targetAgent: to,
                    loadingMessageId,
                    threadId: replyThreadId,
                    parentId: replyId
                }).catch(error => {
                    traceError('Error sending reply to agent:', error);
                });
            }
            
            // Notify the webview about the new reply
            this.postMessage({
                type: 'MESSAGE_ADDED',
                payload: {
                    message: replyMessage
                }
            });
            
            // If viewing thread, update the thread view
            this.postMessage({
                type: 'THREAD_UPDATED',
                payload: {
                    threadId: replyThreadId,
                    message: replyMessage
                }
            });
            
        } catch (error) {
            traceError('Error replying to message:', error);
            vscode.window.showErrorMessage(`Failed to send reply: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Handles downloading a file attachment
     */
    private async _handleDownloadFile(payload: { url: string; name: string }): Promise<void> {
        try {
            // Extract url and name from payload
            const { url, name } = payload;
            
            if (!url || !name) {
                throw new Error('URL and name are required');
            }
            
            // Show save dialog to get the save location
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(name),
                filters: {
                    'All Files': ['*']
                }
            });
            
            if (!saveUri) {
                // User cancelled
                return;
            }
            
            // In a real implementation, we would download the file from the URL
            // For now, just create a sample file
            let fileContent = '';
            
            // Check if this is a code file
            if (url.startsWith('code:')) {
                // Extract code content from URL (in real impl, would be downloaded or retrieved from storage)
                fileContent = url.replace('code:', '');
            } else {
                // Create a placeholder file
                fileContent = `This is a placeholder file for ${name}\nIn a real implementation, this would be downloaded from ${url}`;
            }
            
            // Write the file
            await fs.writeFile(saveUri.fsPath, fileContent);
            
            // Show success message
            vscode.window.showInformationMessage(`File saved to ${saveUri.fsPath}`);
            
        } catch (error) {
            traceError('Error downloading file:', error);
            vscode.window.showErrorMessage(`Failed to download file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    // Internal messages array to store conversation - add this to the class
    private _messages: any[] = [];

    /**
     * Handles agent messages
     */
    private async _handleAgentMessage(messageData: any): Promise<void> {
        try {
            const { content, targetAgent, directTo, loadingMessageId, agentContext, isGroupMessage } = messageData;
            
            try {
                if (isGroupMessage) {
                    // Update the loading message to show status
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: 'We are processing your message to all agents...',
                            status: 'loading'
                        }
                    });
                    
                    // First check network connectivity to provide better error messaging
                    const connectivityCheck = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'check_connectivity') as { status?: string; online?: boolean };
                    const isOnline = connectivityCheck && connectivityCheck.status === 'completed' && connectivityCheck.online === true;
                    
                    if (!isOnline) {
                        traceInfo('Network connectivity check failed before sending group message');
                        // Show a network warning but continue anyway - the server will handle limited functionality
                        this.postMessage({
                            type: 'AGENT_MESSAGE_UPDATE',
                            payload: {
                                id: loadingMessageId,
                                content: 'Network connectivity issues detected. Attempting to process with limited functionality...',
                                status: 'loading'
                            }
                        });
                    }
                    
                    // Send to all agents via CrewAI
                    const response = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'send_message', {
                        message: content,
                        is_group: true
                    }) as { status?: string; response?: string; agent_id?: string; message?: string; limited_functionality?: boolean; error_type?: string };
                    
                    if (response && response.status === 'completed') {
                        // Get the agent that responded
                        let respondingAgent = response.agent_id ? 
                            this._agents.find(a => a.id === response.agent_id) : 
                            this._activeAgents[Math.floor(Math.random() * this._activeAgents.length)];
                        
                        if (!respondingAgent && this._activeAgents.length > 0) {
                            respondingAgent = this._activeAgents[0];
                        }
                        
                        // If the response indicates limited functionality, add a note about it
                        let responseContent = response.response || `I've received your message and the team will coordinate to address this.`;
                        if (response.limited_functionality) {
                            responseContent += `\n\n*Note: Operating with limited functionality due to network or service constraints.*`;
                        }
                        
                        this.postMessage({
                            type: 'AGENT_MESSAGE_UPDATE',
                            payload: {
                                id: loadingMessageId,
                                content: responseContent,
                                status: 'completed',
                                sender: respondingAgent ? respondingAgent.id : 'unknown'
                            }
                        });
                    } else if (response && response.status === 'error') {
                        // Check if it's a network issue
                        if (response.error_type === 'network') {
                            // Try to handle it offline
                            const randomAgent = this._activeAgents[Math.floor(Math.random() * this._activeAgents.length)];
                            this.postMessage({
                                type: 'AGENT_MESSAGE_UPDATE',
                                payload: {
                                    id: loadingMessageId,
                                    content: `I'm currently unable to process your message due to network connectivity issues. Please check your internet connection and try again when you're back online.`,
                                    status: 'completed',
                                    sender: randomAgent ? randomAgent.id : 'unknown'
                                }
                            });
                        } else {
                            throw new Error(response.message || 'Unknown error processing message');
                        }
                    }
                } else if (targetAgent) {
                    const agent = this._agents.find(a => a.id === targetAgent);
                    
                    if (!agent) {
                        throw new Error(`Agent with ID ${targetAgent} not found`);
                    }
                    
                    // Update the loading message
                    this.postMessage({
                        type: 'AGENT_MESSAGE_UPDATE',
                        payload: {
                            id: loadingMessageId,
                            content: `${agent.name} is thinking...`,
                            status: 'loading',
                            directTo: messageData.targetAgent
                        }
                    });
                    
                    // Check network connectivity first
                    const connectivityCheck = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'check_connectivity') as { status?: string; online?: boolean };
                    const isOnline = connectivityCheck && connectivityCheck.status === 'completed' && connectivityCheck.online === true;
                    
                    if (!isOnline) {
                        traceInfo(`Network connectivity check failed before sending message to agent ${agent.name}`);
                        // Show a network warning but continue anyway - the server will handle limited functionality
                        this.postMessage({
                            type: 'AGENT_MESSAGE_UPDATE',
                            payload: {
                                id: loadingMessageId,
                                content: `Attempting to connect with ${agent.name}... Network connectivity issues detected.`,
                                status: 'loading'
                            }
                        });
                    }
                    
                    // Send to specific agent via CrewAI
                    const response = await vscode.commands.executeCommand('mightydev.relayToCrewAI', 'send_message', {
                        message: content,
                        agent_id: targetAgent,
                        directTo: messageData.directTo || targetAgent // Pass directTo explicitly to ensure agent personality traits are included
                    }) as { status?: string; response?: string; message?: string; limited_functionality?: boolean; error_type?: string };
                    
                    if (response && response.status === 'completed') {
                        // If the response indicates limited functionality, add a note about it
                        let responseContent = response.response || `I've processed your message and I'm ready to help.`;
                        if (response.limited_functionality) {
                            responseContent += `\n\n*Note: I'm currently operating with limited functionality due to network or service constraints.*`;
                        }
                        
                        this.postMessage({
                            type: 'AGENT_MESSAGE_UPDATE',
                            payload: {
                                id: loadingMessageId,
                                content: responseContent,
                                status: 'completed',
                                directTo: messageData.targetAgent
                            }
                        });
                    } else if (response && response.status === 'error') {
                        // Check if it's a network issue for targeted messaging
                        if (response.error_type === 'network') {
                            this.postMessage({
                                type: 'AGENT_MESSAGE_UPDATE',
                                payload: {
                                    id: loadingMessageId,
                                    content: `I'm currently unable to process your message due to network connectivity issues. Please check your internet connection and try again when you're back online.`,
                                    status: 'completed',
                                    directTo: messageData.targetAgent
                                }
                            });
                        } else {
                            throw new Error(response.message || 'Unknown error processing message');
                        }
                    }
                }
            } catch (error) {
                traceError('Error using CrewAI extension to handle message:', error);
                
                // Update the UI with the error
                this.postMessage({
                    type: 'AGENT_MESSAGE_UPDATE',
                    payload: {
                        id: loadingMessageId,
                        content: `Error: Could not process message. ${error instanceof Error ? error.message : String(error)}`,
                        status: 'error'
                    }
                });
                
                // Determine error type
                const errorMessage = error instanceof Error ? error.message : String(error);
                let errorType = 'server';
                
                // Check for API key issues
                if (errorMessage.includes('API_KEY_MISSING') || 
                    errorMessage.includes('API key') || 
                    errorMessage.includes('api key')) {
                    errorType = 'api_key';
                }
                // Check for dependency issues
                else if (errorMessage.includes('ModuleNotFound') || 
                         errorMessage.includes('No module named') ||
                         errorMessage.includes('import error')) {
                    errorType = 'dependency';
                }
                
                // Send error status to webview
                this.postMessage({
                    type: 'SERVER_ERROR',
                    payload: {
                        message: `Could not connect to CrewAI server: ${errorMessage}`,
                        canRetry: true,
                        action: 'SEND_MESSAGE',
                        actionPayload: messageData,
                        errorType
                    }
                });
                
                // Show error dialog with retry option
                vscode.window.showErrorMessage(
                    `Failed to connect to CrewAI server. Check that Python dependencies are installed.`,
                    'Retry'
                ).then(selection => {
                    if (selection === 'Retry') {
                        this._handleAgentMessage(messageData);
                    }
                });
            }
            
        } catch (error) {
            traceError('Failed to handle agent message:', error);
            vscode.window.showErrorMessage(`Failed to send message: ${error}`);
            
            // Update the loading message with the error
            this.postMessage({
                type: 'AGENT_MESSAGE_UPDATE',
                payload: {
                    id: messageData.loadingMessageId,
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    status: 'error',
                    directTo: messageData.targetAgent // Preserve directTo property for message filtering
                }
            });
            
            // Send error status to webview
            this.postMessage({
                type: 'SERVER_ERROR',
                payload: {
                    message: `Error handling message: ${error instanceof Error ? error.message : String(error)}`,
                    canRetry: true,
                    action: 'SEND_MESSAGE',
                    actionPayload: messageData
                }
            });
        }
    }

    /**
     * Loads the saved state if it exists
     */
    private async _loadState(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            // Check if this project has been migrated to a different path
            const tribeFolderPath = path.join(this._projectPath, TRIBE_FOLDER);
            const projectFilePath = path.join(tribeFolderPath, 'project.json');
            
            // Check if this is a migrated project that points to a parent project
            if (await fs.pathExists(projectFilePath)) {
                const projectData = await fs.readJson(projectFilePath);
                
                // If this project has been migrated, update the project path and reload
                if (projectData.migrated && projectData.migratedTo) {
                    traceInfo(`This project has been migrated to: ${projectData.migratedTo}`);
                    
                    // Update the project path to use the migrated location
                    if (projectData.migratedTo !== this._projectPath) {
                        this._projectPath = projectData.migratedTo;
                        
                        // Recursively reload state with the new path
                        return this._loadState();
                    }
                }
                
                // Regular loading process
                this._initialized = projectData.initialized || projectData.userInitialized || false;
                this._projectVision = projectData.vision || '';
                this._currentPhase = projectData.currentPhase || 'Planning';
            }
            
            const agentsFilePath = path.join(tribeFolderPath, 'agents.json');
            if (await fs.pathExists(agentsFilePath)) {
                this._agents = await fs.readJson(agentsFilePath);
            }
            
            const activeAgentsFilePath = path.join(tribeFolderPath, 'active-agents.json');
            if (await fs.pathExists(activeAgentsFilePath)) {
                this._activeAgents = await fs.readJson(activeAgentsFilePath);
            }
            
            const tasksFilePath = path.join(tribeFolderPath, 'tasks.json');
            if (await fs.pathExists(tasksFilePath)) {
                this._tasks = await fs.readJson(tasksFilePath);
            }
            
            const decisionsFilePath = path.join(tribeFolderPath, 'decisions.json');
            if (await fs.pathExists(decisionsFilePath)) {
                this._pendingDecisions = await fs.readJson(decisionsFilePath);
            }
            
            // Also load messages
            await this._loadMessages();
            
        } catch (error) {
            traceError('Failed to load state:', error);
        }
    }

    /**
     * Saves the current state
     */
    private async _saveState(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            const tribeFolderPath = path.join(this._projectPath, TRIBE_FOLDER);
            await fs.ensureDir(tribeFolderPath);
            
            // Save project data
            const projectFilePath = path.join(tribeFolderPath, 'project.json');
            await fs.writeJson(projectFilePath, {
                vision: this._projectVision,
                initialized: this._initialized,
                currentPhase: this._currentPhase,
                updatedAt: new Date().toISOString()
            }, { spaces: 2 });
            
            // Save agents
            const agentsFilePath = path.join(tribeFolderPath, 'agents.json');
            await fs.writeJson(agentsFilePath, this._agents, { spaces: 2 });
            
            // Save active agents
            const activeAgentsFilePath = path.join(tribeFolderPath, 'active-agents.json');
            await fs.writeJson(activeAgentsFilePath, this._activeAgents, { spaces: 2 });
            
            // Save tasks
            const tasksFilePath = path.join(tribeFolderPath, 'tasks.json');
            await fs.writeJson(tasksFilePath, this._tasks, { spaces: 2 });
            
            // Save decisions
            const decisionsFilePath = path.join(tribeFolderPath, 'decisions.json');
            await fs.writeJson(decisionsFilePath, this._pendingDecisions, { spaces: 2 });
            
            // Also save messages
            await this._saveMessages();
            
        } catch (error) {
            traceError('Failed to save state:', error);
        }
    }
    
    /**
     * Loads messages from storage
     */
    private async _loadMessages(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            const messagesPath = path.join(this._projectPath, TRIBE_FOLDER, 'messages.json');
            
            if (await fs.pathExists(messagesPath)) {
                this._messages = await fs.readJson(messagesPath);
            } else {
                // Initialize with empty array if file doesn't exist
                this._messages = [];
            }
        } catch (error) {
            traceError('Failed to load messages:', error);
            // Initialize with empty array on error
            this._messages = [];
        }
    }
    
    /**
     * Saves messages to storage
     */
    private async _saveMessages(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            const tribeFolderPath = path.join(this._projectPath, TRIBE_FOLDER);
            await fs.ensureDir(tribeFolderPath);
            
            const messagesPath = path.join(tribeFolderPath, 'messages.json');
            await fs.writeJson(messagesPath, this._messages, { spaces: 2 });
        } catch (error) {
            traceError('Failed to save messages:', error);
        }
    }

    /**
     * Sends the current project state to the webview
     */
    private _sendProjectState(): void {
        if (!this._view) {
            return;
        }
        
        this.postMessage({
            type: 'PROJECT_STATE',
            payload: {
                initialized: this._initialized,
                vision: this._projectVision,
                currentPhase: this._currentPhase,
                agents: this._agents,
                activeAgents: this._activeAgents,
                tasks: this._tasks,
                pendingDecisions: this._pendingDecisions,
                notifications: this._notifications,
                messages: this._messages
            }
        });
    }

    /**
     * Returns the HTML content for the webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview
        // Also get the URI to load this script in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
        traceInfo(`Script URI: ${scriptUri}`);
        
        // Same for stylesheet
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'style.css');
        const styleUri = webview.asWebviewUri(stylePathOnDisk);
        traceInfo(`Style URI: ${styleUri}`);
        
        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();
        
        // Check if the script and style files actually exist on disk
        const scriptExists = fs.existsSync(scriptPathOnDisk.fsPath);
        const styleExists = fs.existsSync(stylePathOnDisk.fsPath);
        
        traceInfo(`Script file exists: ${scriptExists ? 'Yes' : 'No'} (${scriptPathOnDisk.fsPath})`);
        traceInfo(`Style file exists: ${styleExists ? 'Yes' : 'No'} (${stylePathOnDisk.fsPath})`);
        
        if (!scriptExists || !styleExists) {
            // Return a fallback HTML that shows diagnostics info
            return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>MightyDev Tribe - Debug</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
                    .error { color: red; }
                    .success { color: green; }
                    pre { background: #f5f5f5; padding: 10px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h1>MightyDev Tribe Dashboard - Debug Mode</h1>
                <p>The webview resources could not be found. Please build the webview files:</p>
                <pre>cd /Users/boss/Documents/MightyDev/extensions/tribe && npm run build:webview</pre>
                
                <h2>Resource Status:</h2>
                <p class="${scriptExists ? 'success' : 'error'}">
                    Script: ${scriptExists ? 'Found' : 'Not Found'} (${scriptPathOnDisk.fsPath})
                </p>
                <p class="${styleExists ? 'success' : 'error'}">
                    Style: ${styleExists ? 'Found' : 'Not Found'} (${stylePathOnDisk.fsPath})
                </p>
                
                <h2>Webview URI:</h2>
                <p>Script URI: ${scriptUri}</p>
                <p>Style URI: ${styleUri}</p>
            </body>
            </html>`;
        }
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
            <link href="${styleUri}" rel="stylesheet">
            <title>MightyDev Tribe</title>
            <style>
                #loading-fallback {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    color: #333;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                }
                #loading-fallback h1 {
                    margin-bottom: 10px;
                }
                #loading-fallback p {
                    margin-bottom: 20px;
                }
            </style>
        </head>
        <body>
            <div id="root">
                <div id="loading-fallback">
                    <h1>MightyDev Tribe Dashboard</h1>
                    <p>Loading Dashboard...</p>
                    <p>If this message persists, there might be an issue loading the React application.</p>
                </div>
            </div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}