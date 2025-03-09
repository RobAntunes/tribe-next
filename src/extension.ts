// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from 'path';
import * as util from 'util';
import * as fs from 'fs-extra';
import { exec as execCallback } from 'child_process';
import { LanguageClient } from 'vscode-languageclient/node';
import { registerLogger, traceError, traceLog, traceVerbose, traceInfo } from './common/log/logging';

// Promisify exec
const exec = util.promisify(execCallback);
import {
    checkVersion,
    getInterpreterDetails,
    initializePython,
    onDidChangePythonInterpreter,
    resolveInterpreter,
} from './common/python';
import { restartServer } from './common/server';
import { checkIfConfigurationChanged, getInterpreterFromSetting } from './common/settings';
import { loadServerDefaults } from './common/setup';
import { getLSClientTraceLevel, getProjectRoot, isProjectInitialized } from './common/utilities';
import { createOutputChannel, onDidChangeConfiguration, registerCommand } from './common/vscodeapi';
import { CrewPanelProvider } from './common/crewPanelProvider';
import { CrewAIExtension } from './common/crewAIExtension';
import { LearningSystem } from './common/learningSystem';
import { ServerManager } from './common/serverManager';
// Make sure to import the tool classes from the correct path
import { 
    FileSystemTool, 
    CodeAnalysisTool, 
    StructuredOutputTool, 
    MetadataTool,
    MessagingTool,
    Tool
} from './common/tools';
import { 
    EXTENSION_NAME, 
    WEBVIEW_VIEWTYPE, 
    COMMAND_OPEN_TRIBE, 
    COMMAND_INITIALIZE_PROJECT,
    COMMAND_RESET_TRIBE,
    WEBVIEW_TITLE,
    TRIBE_FOLDER
} from './common/constants';

let lsClient: LanguageClient | undefined;
let crewPanelProvider: CrewPanelProvider | undefined;
let crewAIExtension: CrewAIExtension | undefined;
let serverManager: ServerManager | undefined;
let learningSystem: LearningSystem | undefined;
let agentTools: Map<string, any> = new Map();

/**
 * Initialize tools to be used by agents
 */
async function initializeTools(workspaceRoot: string | undefined): Promise<void> {
    if (!workspaceRoot) {
        return;
    }
    
    // Create tools
    try {
        const fileSystemTool = new FileSystemTool(workspaceRoot);
        if (fileSystemTool && fileSystemTool.name) {
            agentTools.set(fileSystemTool.name, fileSystemTool);
            traceInfo(`Registered tool: ${fileSystemTool.name}`);
        }
        
        const codeAnalysisTool = new CodeAnalysisTool(workspaceRoot);
        if (codeAnalysisTool && codeAnalysisTool.name) {
            agentTools.set(codeAnalysisTool.name, codeAnalysisTool);
            traceInfo(`Registered tool: ${codeAnalysisTool.name}`);
        }
        
        const structuredOutputTool = new StructuredOutputTool();
        if (structuredOutputTool && structuredOutputTool.name) {
            agentTools.set(structuredOutputTool.name, structuredOutputTool);
            traceInfo(`Registered tool: ${structuredOutputTool.name}`);
        }
        
        const metadataTool = new MetadataTool();
        if (metadataTool && metadataTool.name) {
            agentTools.set(metadataTool.name, metadataTool);
            traceInfo(`Registered tool: ${metadataTool.name}`);
        }
    } catch (error) {
        traceError('Error initializing tools:', error);
    }
    
    traceInfo(`Initialized ${agentTools.size} agent tools`);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Setup logging first
        const outputChannel = createOutputChannel(EXTENSION_NAME);
        context.subscriptions.push(outputChannel, registerLogger(outputChannel));
        
        // Log extension activation
        traceLog(`MightyDev Extension Activating...`);
        
        try {
            // This is required to get server name and module
            const serverInfo = loadServerDefaults();
            const serverName = serverInfo.name;
            const serverId = serverInfo.module;
            
            // Log Server information
            traceLog(`Server Name: ${serverName}`);
            traceLog(`Server Module: ${serverId}`);
        } catch (error) {
            traceError('Error loading server defaults:', error);
            // Continue anyway, as we might not need the server for basic functionality
        }
        
        // Get project root
        let workspaceRoot: string | undefined;
        try {
            const projectRoot = await getProjectRoot();
            workspaceRoot = projectRoot?.uri.fsPath;
            traceInfo(`Project root: ${workspaceRoot || 'Not found'}`);
        } catch (error) {
            traceError('Error getting project root:', error);
            // Continue without workspace root
        }
        
        // Initialize tools
        try {
            if (workspaceRoot) {
                await initializeTools(workspaceRoot);
            } else {
                traceInfo('No workspace root found. Tools will be initialized when a workspace is opened.');
            }
        } catch (error) {
            traceError('Error initializing tools:', error);
            // Continue without tools
        }
        
        // Create and register the crew panel provider
        try {
            crewPanelProvider = new CrewPanelProvider(context, workspaceRoot);
            traceInfo('CrewPanelProvider initialized');
        } catch (error) {
            traceError('Error creating CrewPanelProvider:', error);
            // Continue without crew panel provider
        }
        
        // Create the CrewAI extension and server manager
        try {
            crewAIExtension = new CrewAIExtension(context);
            traceInfo('CrewAIExtension initialized');
            
            // Create server manager
            serverManager = new ServerManager(context);
            traceInfo('ServerManager initialized');
        } catch (error) {
            traceError('Error creating CrewAIExtension or ServerManager:', error);
            // Continue without CrewAI extension or server manager
        }
        
        // Create the Learning System
        try {
            if (workspaceRoot) {
                learningSystem = new LearningSystem(workspaceRoot);
                traceInfo('LearningSystem initialized');
                
                // Add messaging tool
                if (workspaceRoot && crewAIExtension) {
                    const messagingTool = new MessagingTool(workspaceRoot, 'system', crewAIExtension);
                    agentTools.set(messagingTool.name, messagingTool);
                    traceInfo(`Registered tool: ${messagingTool.name}`);
                    
                    // Load message history from storage
                    await messagingTool.loadFromStorage();
                }
            } else {
                traceInfo('No workspace root found. LearningSystem will be initialized when a workspace is opened.');
            }
        } catch (error) {
            traceError('Error creating LearningSystem:', error);
            // Continue without learning system
        }
    
        // Register the crew panel provider for the webview view
        try {
            // Create the CrewPanelProvider if it wasn't created earlier
            if (!crewPanelProvider) {
                traceInfo('Creating CrewPanelProvider for view registration');
                crewPanelProvider = new CrewPanelProvider(context, workspaceRoot);
            }
            
            // Make sure the WebviewViewProvider is registered
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    WEBVIEW_VIEWTYPE, // Should be 'mightydev.tribeView'
                    crewPanelProvider,
                    {
                        webviewOptions: {
                            retainContextWhenHidden: true
                        }
                    }
                )
            );
            traceInfo(`WebviewViewProvider registered with viewType: ${WEBVIEW_VIEWTYPE}`);
        } catch (error) {
            traceError('Error registering webview view provider:', error);
            // Log more details about the error
            traceError(`Details: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                traceError(`Stack: ${error.stack}`);
            }
        }

    // Register commands
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand(COMMAND_OPEN_TRIBE, async () => {
                try {
                    await openTribeDashboard();
                } catch (error) {
                    traceError('Error opening Tribe Dashboard:', error);
                    vscode.window.showErrorMessage('Failed to open MightyDev Tribe Dashboard.');
                }
            }),
            vscode.commands.registerCommand(COMMAND_INITIALIZE_PROJECT, async () => {
                try {
                    if (!workspaceRoot) {
                        vscode.window.showErrorMessage('MightyDev requires an open workspace to initialize a project.');
                        return;
                    }
                    
                    try {
                        if (await isProjectInitialized(workspaceRoot)) {
                            vscode.window.showInformationMessage('This project is already initialized with MightyDev.');
                            await openTribeDashboard();
                            return;
                        }
                    } catch (error) {
                        traceError('Error checking if project is initialized:', error);
                    }
                    
                    // Start the CrewAI server if we have a workspace
                    if (serverManager && workspaceRoot) {
                        try {
                            const serverStarted = await serverManager.startServer(workspaceRoot);
                            if (!serverStarted) {
                                traceError('Failed to start CrewAI server');
                                vscode.window.showErrorMessage('Failed to start CrewAI server. Please check the logs for details.');
                            }
                        } catch (error) {
                            traceError('Error starting CrewAI server:', error);
                            vscode.window.showErrorMessage(`Error starting CrewAI server: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    
                    await openTribeDashboard();
                } catch (error) {
                    traceError('Error in initialize project command:', error);
                    vscode.window.showErrorMessage('Failed to initialize MightyDev project.');
                }
            }),
            vscode.commands.registerCommand(COMMAND_RESET_TRIBE, async () => {
                try {
                    const result = await vscode.window.showWarningMessage(
                        'Are you sure you want to reset MightyDev? This will delete all agent data and project configuration.',
                        { modal: true },
                        'Reset'
                    );
                    
                    if (result === 'Reset') {
                        if (crewPanelProvider) {
                            try {
                                crewPanelProvider.postMessage({ type: 'RESET_TRIBE', payload: {} });
                            } catch (error) {
                                traceError('Error sending reset message to panel:', error);
                            }
                        }
                        
                        // Stop the CrewAI server
                        if (crewAIExtension) {
                            try {
                                await crewAIExtension.stopServer();
                            } catch (error) {
                                traceError('Error stopping CrewAI server:', error);
                            }
                        }
                    }
                } catch (error) {
                    traceError('Error in reset tribe command:', error);
                    vscode.window.showErrorMessage('Failed to reset MightyDev.');
                }
            })
        );
    } catch (error) {
        traceError('Error registering commands:', error);
    }

    // Register a command to execute agent tools
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand('mightydev.executeAgentTool', async (toolName: string, params: any) => {
                try {
                    const tool = agentTools.get(toolName);
                    if (!tool) {
                        throw new Error(`Tool '${toolName}' not found`);
                    }
                    
                    const result = await tool.execute(params);
                    return result;
                } catch (error) {
                    traceError(`Error executing tool '${toolName}':`, error);
                    throw error;
                }
            })
        );
    } catch (error) {
        traceError('Error registering executeAgentTool command:', error);
    }
    
    // Register commands for the learning system
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand('mightydev.captureExperience', async (experience: any) => {
                try {
                    if (!learningSystem) {
                        throw new Error('Learning system not initialized');
                    }
                    
                    const result = await learningSystem.captureExperience(experience);
                    return result;
                } catch (error) {
                    traceError('Error capturing experience:', error);
                    throw error;
                }
            }),
            
            vscode.commands.registerCommand('mightydev.extractPatterns', async (agentId: string, topic: string) => {
                try {
                    if (!learningSystem) {
                        throw new Error('Learning system not initialized');
                    }
                    
                    const result = await learningSystem.extractPatterns(agentId, topic);
                    return result;
                } catch (error) {
                    traceError('Error extracting patterns:', error);
                    throw error;
                }
            }),
            
            vscode.commands.registerCommand('mightydev.collectFeedback', async (feedback: any) => {
                try {
                    if (!learningSystem) {
                        throw new Error('Learning system not initialized');
                    }
                    
                    const result = await learningSystem.collectFeedback(feedback);
                    return result;
                } catch (error) {
                    traceError('Error collecting feedback:', error);
                    throw error;
                }
            }),
            
            vscode.commands.registerCommand('mightydev.createReflection', async (reflection: any) => {
                try {
                    if (!learningSystem) {
                        throw new Error('Learning system not initialized');
                    }
                    
                    const result = await learningSystem.createReflection(reflection);
                    return result;
                } catch (error) {
                    traceError('Error creating reflection:', error);
                    throw error;
                }
            }),
            
            vscode.commands.registerCommand('mightydev.generateLearningSummary', async (agentId: string) => {
                try {
                    if (!learningSystem) {
                        throw new Error('Learning system not initialized');
                    }
                    
                    const result = await learningSystem.generateLearningSummary(agentId);
                    return result;
                } catch (error) {
                    traceError('Error generating learning summary:', error);
                    throw error;
                }
            })
        );
    } catch (error) {
        traceError('Error registering learning system commands:', error);
    }

    try {
        const changeLogLevel = async (c: vscode.LogLevel, g: vscode.LogLevel) => {
            try {
                const level = getLSClientTraceLevel(c, g);
                await lsClient?.setTrace(level);
            } catch (error) {
                traceError('Error changing log level:', error);
            }
        };

        context.subscriptions.push(
            outputChannel.onDidChangeLogLevel(async (e) => {
                await changeLogLevel(e, vscode.env.logLevel);
            }),
            vscode.env.onDidChangeLogLevel(async (e) => {
                await changeLogLevel(outputChannel.logLevel, e);
            }),
        );
    } catch (error) {
        traceError('Error setting up logging:', error);
    }

    // Run server initialization in a try-catch block
    try {
        const runServer = async () => {
            try {
                let serverInfo;
                let serverName;
                let serverId;
                try {
                    serverInfo = loadServerDefaults();
                    serverName = serverInfo.name;
                    serverId = serverInfo.module;
                } catch (error) {
                    traceError('Error loading server defaults:', error);
                    return;
                }

                const interpreter = getInterpreterFromSetting(serverId);
                if (interpreter && interpreter.length > 0) {
                    try {
                        const resolvedInterpreter = await resolveInterpreter(interpreter);
                        if (checkVersion(resolvedInterpreter)) {
                            traceVerbose(`Using interpreter from ${serverId}.interpreter: ${interpreter.join(' ')}`);
                            lsClient = await restartServer(serverId, serverName, outputChannel, lsClient);
                        }
                        return;
                    } catch (error) {
                        traceError('Error resolving interpreter:', error);
                    }
                }

                try {
                    const interpreterDetails = await getInterpreterDetails();
                    if (interpreterDetails.path) {
                        traceVerbose(`Using interpreter from Python extension: ${interpreterDetails.path.join(' ')}`);
                        lsClient = await restartServer(serverId, serverName, outputChannel, lsClient);
                        return;
                    }
                } catch (error) {
                    traceError('Error getting interpreter details:', error);
                }

                traceError(
                    'Python interpreter missing:\r\n' +
                        '[Option 1] Select python interpreter using the ms-python.python.\r\n' +
                        `[Option 2] Set an interpreter using "${serverId}.interpreter" setting.\r\n` +
                        'Please use Python 3.8 or greater.',
                );
            } catch (error) {
                traceError('Error in runServer:', error);
            }
        };

        try {
            context.subscriptions.push(
                onDidChangePythonInterpreter(async () => {
                    await runServer();
                }),
                onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
                    try {
                        const serverInfo = loadServerDefaults();
                        const serverId = serverInfo.module;
                        if (checkIfConfigurationChanged(e, serverId)) {
                            await runServer();
                        }
                    } catch (error) {
                        traceError('Error in configuration change handler:', error);
                    }
                }),
                registerCommand(`mightydev.restart`, async () => {
                    await runServer();
                }),
            );
        } catch (error) {
            traceError('Error registering server-related handlers:', error);
        }

        setImmediate(async () => {
            try {
                let serverId;
                try {
                    const serverInfo = loadServerDefaults();
                    serverId = serverInfo.module;
                } catch (error) {
                    traceError('Error loading server defaults:', error);
                    return;
                }

                const interpreter = getInterpreterFromSetting(serverId);
                if (interpreter === undefined || interpreter.length === 0) {
                    traceLog(`Python extension loading`);
                    await initializePython(context.subscriptions);
                    traceLog(`Python extension loaded`);
                } else {
                    await runServer();
                }
            } catch (error) {
                traceError('Error in setImmediate callback:', error);
            }
        });
    } catch (error) {
        traceError('Error setting up server initialization:', error);
    }
    
    // Show getting started info if this is a new workspace
    try {
        if (workspaceRoot) {
            try {
                const isInitialized = await isProjectInitialized(workspaceRoot);
                
                if (!isInitialized) {
                    vscode.window.showInformationMessage(
                        'Welcome to MightyDev! Initialize your project to get started.',
                        'Initialize Project'
                    ).then(selection => {
                        if (selection === 'Initialize Project') {
                            vscode.commands.executeCommand(COMMAND_INITIALIZE_PROJECT);
                        }
                    });
                } else if (serverManager) {
                    // If the project is already initialized, start the CrewAI server
                    try {
                        const serverStarted = await serverManager.startServer(workspaceRoot);
                        if (!serverStarted) {
                            traceError('Failed to start CrewAI server for initialized project');
                            vscode.window.showErrorMessage('Failed to start CrewAI server. Please check the logs for details.');
                        }
                    } catch (error) {
                        traceError('Error starting CrewAI server for initialized project:', error);
                        vscode.window.showErrorMessage(`Error starting CrewAI server: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            } catch (error) {
                traceError('Error checking if project is initialized:', error);
            }
        }
    } catch (error) {
        traceError('Error handling getting started info:', error);
    }
    
    // Set up communication between crewPanelProvider and server manager
    try {
        if (crewPanelProvider && serverManager) {
            // Register a command to start the CrewAI server
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.startCrewAIServer', async (projectPath: string) => {
                    try {
                        if (!serverManager) {
                            throw new Error('Server manager not initialized');
                        }
                        
                        const serverStarted = await serverManager.startServer(projectPath);
                        if (!serverStarted) {
                            throw new Error('Failed to start CrewAI server');
                        }
                        
                        return true;
                    } catch (error) {
                        traceError('Error starting CrewAI server:', error);
                        throw error;
                    }
                })
            );
            
            // Register command to handle GET_ENV_FILES
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.getEnvFiles', async () => {
                    try {
                        const locations = [];
                        
                        if (workspaceRoot) {
                            // Project root .env
                            locations.push({
                                path: path.join(workspaceRoot, '.env'),
                                exists: await fs.pathExists(path.join(workspaceRoot, '.env'))
                            });
                            
                            // Project .tribe/.env
                            const tribeFolderPath = path.join(workspaceRoot, TRIBE_FOLDER);
                            await fs.ensureDir(tribeFolderPath);
                            const tribeEnvPath = path.join(tribeFolderPath, '.env');
                            locations.push({
                                path: tribeEnvPath,
                                exists: await fs.pathExists(tribeEnvPath)
                            });
                        }
                        
                        return { envFiles: locations };
                    } catch (error) {
                        traceError('Error getting env files:', error);
                        return { envFiles: [] };
                    }
                })
            );
            
            // Register command to handle GET_ENV_VARIABLES
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.getEnvVariables', async (filePath: string) => {
                    try {
                        if (!filePath) return { variables: [] };
                        
                        // Check if file exists
                        const exists = await fs.pathExists(filePath);
                        if (!exists) {
                            return { 
                                variables: [
                                    { key: 'ANTHROPIC_API_KEY', value: '', description: 'Anthropic API Key for Claude models', isSecret: true },
                                    { key: 'OPENAI_API_KEY', value: '', description: 'OpenAI API Key (fallback)', isSecret: true }
                                ] 
                            };
                        }
                        
                        // Parse .env file
                        const content = await fs.readFile(filePath, 'utf8');
                        const variables = [];
                        let currentDescription = '';
                        
                        for (const line of content.split('\n')) {
                            const trimmedLine = line.trim();
                            
                            // Skip empty lines
                            if (!trimmedLine) continue;
                            
                            // Handle comments as descriptions
                            if (trimmedLine.startsWith('#')) {
                                currentDescription = trimmedLine.substring(1).trim();
                                continue;
                            }
                            
                            // Handle key=value pairs
                            const match = trimmedLine.match(/^([^=]+)=(.*)$/);
                            if (match) {
                                const key = match[1].trim();
                                const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
                                
                                variables.push({
                                    key,
                                    value,
                                    description: currentDescription,
                                    isSecret: key.includes('API_KEY') || key.includes('SECRET') || key.includes('PASSWORD'),
                                });
                                
                                currentDescription = '';
                            }
                        }
                        
                        // If file is empty or has no vars, add template vars
                        if (variables.length === 0) {
                            variables.push(
                                { key: 'ANTHROPIC_API_KEY', value: '', description: 'Anthropic API Key for Claude models', isSecret: true },
                                { key: 'OPENAI_API_KEY', value: '', description: 'OpenAI API Key (fallback)', isSecret: true }
                            );
                        }
                        
                        return { variables };
                    } catch (error) {
                        traceError('Error getting env variables:', error);
                        return { variables: [] };
                    }
                })
            );
            
            // Register command to handle SAVE_ENV_FILE
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.saveEnvFile', async (filePath: string, content: string) => {
                    try {
                        if (!filePath) throw new Error('No file path specified');
                        
                        // Ensure the directory exists
                        const dirPath = path.dirname(filePath);
                        await fs.ensureDir(dirPath);
                        
                        // Write the file
                        await fs.writeFile(filePath, content);
                        
                        // Restart the CrewAI server to apply new variables
                        if (crewAIExtension && workspaceRoot) {
                            try {
                                await crewAIExtension.stopServer(true);
                                await crewAIExtension.startServer(workspaceRoot);
                            } catch (error) {
                                traceError('Error restarting CrewAI server after env update:', error);
                            }
                        }
                        
                        return { success: true };
                    } catch (error) {
                        traceError('Error saving env file:', error);
                        return { success: false, message: error instanceof Error ? error.message : String(error) };
                    }
                })
            );
        
            // Listen for events from the webview and relay them to the CrewAI extension
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.relayToCrewAI', async (command: string, payload: any) => {
                    try {
                        if (!crewAIExtension) {
                            return;
                        }
                        
                        const response = await crewAIExtension.sendRequest(command, payload);
                        return response;
                    } catch (error) {
                        traceError(`Error relaying to CrewAI:`, error);
                        throw error;
                    }
                })
            );
            
            // Handle COMMAND messages from the webview
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.handleCommand', async (message: any) => {
                    try {
                        if (!message || !message.command) {
                            throw new Error('Invalid command message');
                        }
                        
                        // Handle command messages
                        const command = message.command;
                        const payload = message.payload;
                        
                        // Execute the command
                        return await vscode.commands.executeCommand(command, ...payload);
                    } catch (error) {
                        traceError(`Error handling command:`, error);
                        throw error;
                    }
                })
            );
            
            // Register command to run setup script
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.runSetup', async () => {
                    try {
                        const terminal = vscode.window.createTerminal('MightyDev Setup');
                        terminal.show();
                        
                        // Determine the setup script to run based on platform
                        if (process.platform === 'win32') {
                            terminal.sendText('.\\setup.ps1');
                        } else {
                            terminal.sendText('chmod +x ./setup.sh && ./setup.sh');
                        }
                        
                        return { success: true };
                    } catch (error) {
                        traceError('Error running setup script:', error);
                        vscode.window.showErrorMessage('Failed to run setup script: ' + error);
                        return { success: false, error };
                    }
                })
            );
            
            // Register command to open the environment manager
            context.subscriptions.push(
                vscode.commands.registerCommand('mightydev.openEnvManager', async () => {
                    try {
                        // Simply notify the webview to switch to the environment tab
                        if (crewPanelProvider) {
                            crewPanelProvider.postMessage({
                                type: 'OPEN_ENV_MANAGER',
                                payload: {}
                            });
                        }
                        return { success: true };
                    } catch (error) {
                        traceError('Error opening environment manager:', error);
                        return { success: false, error };
                    }
                })
            );
        }
    } catch (error) {
        traceError('Error setting up communication between panel and CrewAI:', error);
    }
    
    traceInfo('MightyDev extension activated');
    } catch (error) {
        traceError('Error in extension activation:', error);
        throw error; // Let VS Code know the activation failed
    }
}

/**
 * Opens the Tribe Dashboard panel
 */
async function openTribeDashboard(): Promise<void> {
    try {
        // Log the attempt
        traceInfo('Attempting to open Tribe Dashboard');
    
        // First try to show the MightyDev sidebar if it's not visible
        try {
            await vscode.commands.executeCommand('workbench.view.extension.mightydev-sidebar');
            traceInfo('MightyDev sidebar shown');
        } catch (error) {
            traceError('Error showing MightyDev sidebar:', error);
        }
    
        // Then try to focus the specific webview
        try {
            await vscode.commands.executeCommand('mightydev.tribeView.focus');
            traceInfo('Tribe Dashboard focused');
        } catch (error) {
            traceError('Error focusing Tribe Dashboard:', error);
            
            // Another attempt with direct command
            try {
                const webviewView = await vscode.commands.executeCommand('workbench.view.extension.mightydev-sidebar');
                traceInfo('MightyDev sidebar shown with result:', webviewView ? 'success' : 'failure');
            } catch (innerError) {
                traceError('Error showing view with workbench command:', innerError);
                vscode.window.showErrorMessage('Failed to open MightyDev Tribe Dashboard.');
            }
        }
    } catch (error) {
        traceError('Error in openTribeDashboard:', error);
        vscode.window.showErrorMessage('Failed to open MightyDev Tribe Dashboard.');
    }
}

export async function deactivate(): Promise<void> {
    try {
        traceInfo('Deactivating MightyDev extension...');
        
        // Stop the CrewAI server with forceful termination if needed
        if (crewAIExtension) {
            try {
                await crewAIExtension.stopServer(true); // Force stop
                traceInfo('CrewAI server stopped');
            } catch (error) {
                traceError('Error stopping CrewAI server:', error);
                
                // Attempt to forcefully kill any remaining Python processes
                try {
                    if (process.platform === 'win32') {
                        await exec('taskkill /F /IM python.exe /T');
                    } else {
                        // Find and kill any Python processes running our server script
                        await exec("ps aux | grep crewai_server.py | grep -v grep | awk '{print $2}' | xargs -r kill -9");
                    }
                    traceInfo('Forcefully terminated Python processes');
                } catch (killError) {
                    traceError('Error forcefully terminating Python processes:', killError);
                }
            }
        }
        
        // Check for any remaining server processes by checking if the port is still in use
        try {
            const net = require('net');
            const testSocket = new net.Socket();
            const connectionPromise = new Promise<void>((resolve) => {
                testSocket.once('connect', () => {
                    // Connection successful, a server is still running
                    testSocket.destroy();
                    traceError('A server is still running on port 9876');
                    
                    // Try forceful termination again
                    if (process.platform === 'win32') {
                        exec('taskkill /F /IM python.exe /T');
                    } else {
                        exec("lsof -i :9876 | grep LISTEN | awk '{print $2}' | xargs -r kill -9");
                    }
                    resolve();
                });
                
                testSocket.once('error', () => {
                    // Connection failed, the port is free
                    testSocket.destroy();
                    resolve();
                });
            });
            
            // Set a timeout for the connection attempt
            testSocket.setTimeout(1000);
            testSocket.once('timeout', () => {
                testSocket.destroy();
            });
            
            // Try to connect to the default port
            testSocket.connect(9876, 'localhost');
            
            // Wait for the connection attempt to complete
            await connectionPromise;
        } catch (error) {
            traceError('Error checking for remaining server processes:', error);
        }
        
        // Clear tools
        try {
            agentTools.clear();
            traceInfo('Agent tools cleared');
        } catch (error) {
            traceError('Error clearing agent tools:', error);
        }
        
        // Stop language server client
        if (lsClient) {
            try {
                await lsClient.stop();
                traceInfo('Language server client stopped');
            } catch (error) {
                traceError('Error stopping language server client:', error);
            }
        }
        
        traceInfo('MightyDev extension deactivated');
    } catch (error) {
        traceError('Error in extension deactivation:', error);
    }
}
