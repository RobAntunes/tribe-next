// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as path from 'path';
import { LogLevel, Uri, WorkspaceFolder, window } from 'vscode';
import { Trace } from 'vscode-jsonrpc/node';
import { getWorkspaceFolders } from './vscodeapi';
import { traceInfo, traceError } from './log/logging';

// Constants
const TRIBE_FOLDER = '.tribe';

function logLevelToTrace(logLevel: LogLevel): Trace {
    switch (logLevel) {
        case LogLevel.Error:
        case LogLevel.Warning:
        case LogLevel.Info:
            return Trace.Messages;

        case LogLevel.Debug:
        case LogLevel.Trace:
            return Trace.Verbose;

        case LogLevel.Off:
        default:
            return Trace.Off;
    }
}

export function getLSClientTraceLevel(channelLogLevel: LogLevel, globalLogLevel: LogLevel): Trace {
    if (channelLogLevel === LogLevel.Off) {
        return logLevelToTrace(globalLogLevel);
    }
    if (globalLogLevel === LogLevel.Off) {
        return logLevelToTrace(channelLogLevel);
    }
    const level = logLevelToTrace(channelLogLevel <= globalLogLevel ? channelLogLevel : globalLogLevel);
    return level;
}

export async function getProjectRoot(): Promise<WorkspaceFolder> {
    const workspaces: readonly WorkspaceFolder[] = getWorkspaceFolders();
    if (workspaces.length === 0) {
        return {
            uri: Uri.file(process.cwd()),
            name: path.basename(process.cwd()),
            index: 0,
        };
    } else if (workspaces.length === 1) {
        return workspaces[0];
    } else {
        let rootWorkspace = workspaces[0];
        let root = undefined;
        for (const w of workspaces) {
            if (await fs.pathExists(w.uri.fsPath)) {
                root = w.uri.fsPath;
                rootWorkspace = w;
                break;
            }
        }

        for (const w of workspaces) {
            if (root && root.length > w.uri.fsPath.length && (await fs.pathExists(w.uri.fsPath))) {
                root = w.uri.fsPath;
                rootWorkspace = w;
            }
        }
        return rootWorkspace;
    }
}

/**
 * Generates a nonce (number used once) for security purposes
 * This is used to ensure that only specific scripts can run in the webview
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Project Persistence Utilities
 * These functions help manage the .tribe directory structure and project metadata
 */

/**
 * Find all .tribe folders in the project hierarchy (both in current dir and parent dirs)
 * @param startPath The starting path to check from
 * @returns Object with all found project paths and their .tribe folder locations
 */
export async function findAllProjectPaths(startPath: string): Promise<{
    current?: string;    // Current dir .tribe if exists
    parent?: string;     // Highest parent dir with .tribe
    all: string[];       // All dirs with .tribe in order from highest to lowest
}> {
    const result = {
        current: undefined as string | undefined,
        parent: undefined as string | undefined,
        all: [] as string[]
    };
    
    try {
        // Start with the current directory
        let currentPath = startPath;
        
        // Check if the current path has a .tribe folder
        if (await fs.pathExists(path.join(currentPath, TRIBE_FOLDER))) {
            result.current = currentPath;
            result.all.push(currentPath);
        }
        
        // Walk up the directory tree until we reach the file system root
        while (currentPath !== path.parse(currentPath).root) {
            // Move up to the parent directory
            const parentPath = path.dirname(currentPath);
            
            // Check if we've reached the file system root
            if (parentPath === currentPath) {
                break;
            }
            
            // Check if the parent path has a .tribe folder
            if (await fs.pathExists(path.join(parentPath, TRIBE_FOLDER))) {
                // If this is the first parent with .tribe, record it
                if (!result.parent) {
                    result.parent = parentPath;
                }
                
                // Add to all paths
                result.all.push(parentPath);
            }
            
            // Move up to the parent directory
            currentPath = parentPath;
        }
        
        return result;
    } catch (error) {
        // If there's an error, return just the arrays with what we found
        return result;
    }
}

/**
 * Find the root project path by checking for .tribe folders in parent directories
 * @param startPath The starting path to check from
 * @returns The path containing the highest-level .tribe folder, or the original path if none found
 */
export async function findRootProjectPath(startPath: string): Promise<string> {
    try {
        const projectPaths = await findAllProjectPaths(startPath);
        
        // If we found a parent with .tribe, use that
        if (projectPaths.parent) {
            return projectPaths.parent;
        }
        
        // If we found a .tribe in current dir, use that
        if (projectPaths.current) {
            return projectPaths.current;
        }
        
        // Default to original path
        return startPath;
    } catch (error) {
        // If there's an error, return the original path
        return startPath;
    }
}

/**
 * Get the project vision from project.json
 * @param projectPath Path to the project root
 * @returns The project vision or undefined if not found
 */
export async function getProjectVision(projectPath: string): Promise<string | undefined> {
    try {
        // First find the root project path
        const rootPath = await findRootProjectPath(projectPath);
        
        const tribeFolderPath = path.join(rootPath, TRIBE_FOLDER);
        const projectFilePath = path.join(tribeFolderPath, 'project.json');
        
        if (await fs.pathExists(projectFilePath)) {
            const projectData = await fs.readJson(projectFilePath);
            
            // Check for vision field
            if (projectData.vision) {
                return projectData.vision;
            }
            
            // Check for description field as fallback
            if (projectData.description && projectData.description !== 'MightyDev Project') {
                return projectData.description;
            }
        }
        
        return undefined;
    } catch (error) {
        return undefined;
    }
}

/**
 * Checks if a given project has been initialized with MightyDev
 * @param projectPath Path to the project root
 */
export async function isProjectInitialized(projectPath: string): Promise<boolean> {
    try {
        // First find the root project path
        const rootPath = await findRootProjectPath(projectPath);
        
        const tribeFolderPath = path.join(rootPath, TRIBE_FOLDER);
        const projectFilePath = path.join(tribeFolderPath, 'project.json');
        
        if (await fs.pathExists(projectFilePath)) {
            const projectData = await fs.readJson(projectFilePath);
            
            // Check for userInitialized flag first (new in this version)
            if (projectData.userInitialized === true) {
                return true;
            }
            
            // Next, check the traditional flags
            if (projectData.initialized === true || projectData.state === 'initialized') {
                return true;
            }
            
            // Check if we have agents and tasks as a practical sign of initialization
            // This helps handle edge cases from older versions
            try {
                const agentsFilePath = path.join(tribeFolderPath, 'agents', 'index.json');
                if (await fs.pathExists(agentsFilePath)) {
                    const agentsData = await fs.readJson(agentsFilePath);
                    if (agentsData.agents && agentsData.agents.length > 0) {
                        // If we have agents, let's consider the project initialized
                        return true;
                    }
                }
            } catch (agentsError) {
                // Ignore errors reading agents file, continue with other checks
            }
        }
        
        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Creates the .tribe folder structure in the specified project folder
 * @param projectFolder Project folder path
 * @param projectMetadata Optional project metadata to initialize with
 */
export async function createTribeFolder(
    projectFolder: string, 
    projectMetadata?: { name: string; description: string; }
): Promise<boolean> {
    try {
        const tribeFolderPath = path.join(projectFolder, TRIBE_FOLDER);
        
        // Create main .tribe folder
        await fs.ensureDir(tribeFolderPath);
        
        // Create subfolders for better organization
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
        
        // Initialize project.json if metadata is provided
        if (projectMetadata) {
            const projectData = {
                name: projectMetadata.name || path.basename(projectFolder),
                description: projectMetadata.description || 'No description provided',
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                state: 'initializing',
                initialized: true
            };
            
            await writeJsonFile(path.join(tribeFolderPath, 'project.json'), projectData);
        }
        
        // Create empty default files to initialize the structure
        const defaultFiles = [
            { path: 'agents/index.json', content: { agents: [] } },
            { path: 'tasks/index.json', content: { tasks: [] } },
            { path: 'teams/index.json', content: { teams: [] } },
            { path: 'memory/index.json', content: { memories: [] } },
        ];
        
        for (const file of defaultFiles) {
            const filePath = path.join(tribeFolderPath, file.path);
            if (!(await fileExists(filePath))) {
                await writeJsonFile(filePath, file.content);
            }
        }
        
        traceInfo(`Created .tribe folder structure at ${tribeFolderPath}`);
        return true;
    } catch (err) {
        traceError('Error creating .tribe folder structure:', err);
        return false;
    }
}

/**
 * Check if a file exists
 * @param filePath Path to file
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        return await fs.pathExists(filePath);
    } catch (err) {
        return false;
    }
}

/**
 * Write a JSON file
 * @param filePath Path to file
 * @param data Data to write
 * @param pretty Whether to format the JSON with indentation
 */
export async function writeJsonFile(filePath: string, data: any, pretty: boolean = true): Promise<boolean> {
    try {
        await fs.ensureDir(path.dirname(filePath));
        const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    } catch (err) {
        traceError(`Error writing JSON file ${filePath}:`, err);
        return false;
    }
}

/**
 * Read a JSON file
 * @param filePath Path to file
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content) as T;
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            // Only log error if file exists but could not be parsed
            traceError(`Error reading JSON file ${filePath}:`, err);
        }
        return null;
    }
}

/**
 * Check if tribe folder exists in the project
 * @param projectFolder Project folder path
 */
export async function tribeFolderExists(projectFolder: string): Promise<boolean> {
    const tribeFolderPath = path.join(projectFolder, TRIBE_FOLDER);
    return await fileExists(tribeFolderPath);
}

/**
 * Get the path to the .tribe folder
 * @param projectFolder Project folder path
 */
export function getTribeFolderPath(projectFolder: string): string {
    return path.join(projectFolder, TRIBE_FOLDER);
}

/**
 * Get the path to a specific subfolder in the .tribe directory
 * @param projectFolder Project folder path
 * @param subfolder Name of the subfolder (agents, tasks, teams, memory, etc.)
 */
export function getTribeSubfolderPath(projectFolder: string, subfolder: string): string {
    return path.join(projectFolder, TRIBE_FOLDER, subfolder);
}

/**
 * Ensure a specific subfolder exists in the .tribe directory
 * @param projectFolder Project folder path
 * @param subfolder Name of the subfolder to ensure exists
 */
export async function ensureTribeSubfolder(projectFolder: string, subfolder: string): Promise<string> {
    const subfolderPath = getTribeSubfolderPath(projectFolder, subfolder);
    await fs.ensureDir(subfolderPath);
    return subfolderPath;
}

/**
 * Store agent metadata in the .tribe folder
 * @param projectFolder Project folder path
 * @param agentId Unique ID of the agent
 * @param agentData Agent metadata to store
 */
export async function storeAgentMetadata(
    projectFolder: string, 
    agentId: string, 
    agentData: any
): Promise<boolean> {
    try {
        const agentsFolder = await ensureTribeSubfolder(projectFolder, 'agents');
        const agentFilePath = path.join(agentsFolder, `${agentId}.json`);
        
        // Add timestamps
        const dataToStore = {
            ...agentData,
            lastModified: new Date().toISOString()
        };
        
        if (!dataToStore.createdAt) {
            dataToStore.createdAt = new Date().toISOString();
        }
        
        // Write agent data to its individual file
        await writeJsonFile(agentFilePath, dataToStore);
        
        // Update the agents index
        const indexPath = path.join(agentsFolder, 'index.json');
        let index = await readJsonFile<{agents: {id: string, name: string}[]}>(indexPath) || { agents: [] };
        
        // Check if agent already exists in index
        const agentIndex = index.agents.findIndex(a => a.id === agentId);
        if (agentIndex >= 0) {
            // Update existing entry
            index.agents[agentIndex] = { 
                id: agentId, 
                name: agentData.character_name || agentData.name || agentData.role || agentId 
            };
        } else {
            // Add new entry
            index.agents.push({
                id: agentId,
                name: agentData.character_name || agentData.name || agentData.role || agentId
            });
        }
        
        // Write updated index
        await writeJsonFile(indexPath, index);
        
        return true;
    } catch (err) {
        traceError(`Error storing agent metadata for ${agentId}:`, err);
        return false;
    }
}

/**
 * Get agent metadata from the .tribe folder
 * @param projectFolder Project folder path
 * @param agentId Unique ID of the agent
 */
export async function getAgentMetadata(projectFolder: string, agentId: string): Promise<any | null> {
    try {
        const agentsFolder = getTribeSubfolderPath(projectFolder, 'agents');
        const agentFilePath = path.join(agentsFolder, `${agentId}.json`);
        
        return await readJsonFile(agentFilePath);
    } catch (err) {
        traceError(`Error reading agent metadata for ${agentId}:`, err);
        return null;
    }
}

/**
 * Get all agent metadata from the .tribe folder
 * @param projectFolder Project folder path
 */
export async function getAllAgents(projectFolder: string): Promise<any[]> {
    try {
        const agentsFolder = getTribeSubfolderPath(projectFolder, 'agents');
        const indexPath = path.join(agentsFolder, 'index.json');
        
        const index = await readJsonFile<{agents: {id: string, name: string}[]}>(indexPath);
        if (!index) {
            return [];
        }
        
        // Load full agent data for each agent in the index
        const agentPromises = index.agents.map(agent => getAgentMetadata(projectFolder, agent.id));
        const agents = await Promise.all(agentPromises);
        
        // Filter out null results (agents that couldn't be loaded)
        return agents.filter(agent => agent !== null);
    } catch (err) {
        traceError('Error reading all agents:', err);
        return [];
    }
}

/**
 * Store task data in the .tribe folder
 * @param projectFolder Project folder path
 * @param taskId Unique ID of the task
 * @param taskData Task data to store
 */
export async function storeTaskData(
    projectFolder: string, 
    taskId: string, 
    taskData: any
): Promise<boolean> {
    try {
        const tasksFolder = await ensureTribeSubfolder(projectFolder, 'tasks');
        const taskFilePath = path.join(tasksFolder, `${taskId}.json`);
        
        // Add timestamps
        const dataToStore = {
            ...taskData,
            lastModified: new Date().toISOString()
        };
        
        if (!dataToStore.createdAt) {
            dataToStore.createdAt = new Date().toISOString();
        }
        
        // Write task data to its individual file
        await writeJsonFile(taskFilePath, dataToStore);
        
        // Update the tasks index
        const indexPath = path.join(tasksFolder, 'index.json');
        let index = await readJsonFile<{tasks: {id: string, description: string}[]}>(indexPath) || { tasks: [] };
        
        // Get a short description for the index
        const shortDescription = taskData.description ? 
            (taskData.description.length > 100 ? 
                taskData.description.substring(0, 97) + '...' : 
                taskData.description) :
            'No description';
        
        // Check if task already exists in index
        const taskIndex = index.tasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
            // Update existing entry
            index.tasks[taskIndex] = { id: taskId, description: shortDescription };
        } else {
            // Add new entry
            index.tasks.push({ id: taskId, description: shortDescription });
        }
        
        // Write updated index
        await writeJsonFile(indexPath, index);
        
        return true;
    } catch (err) {
        traceError(`Error storing task data for ${taskId}:`, err);
        return false;
    }
}

/**
 * Store memory or learning data in the .tribe folder
 * @param projectFolder Project folder path
 * @param memoryType Type of memory (experience, insight, feedback, reflection)
 * @param memoryData Memory data to store
 */
export async function storeMemory(
    projectFolder: string,
    memoryType: 'experience' | 'insight' | 'feedback' | 'reflection',
    memoryData: any
): Promise<string | null> {
    try {
        const memoryFolder = await ensureTribeSubfolder(projectFolder, 'memory');
        const typeFolder = path.join(memoryFolder, memoryType);
        await fs.ensureDir(typeFolder);
        
        // Generate a unique ID for this memory
        const memoryId = `${memoryType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const memoryFilePath = path.join(memoryFolder, memoryType, `${memoryId}.json`);
        
        // Add timestamps and ID
        const dataToStore = {
            ...memoryData,
            id: memoryId,
            type: memoryType,
            createdAt: new Date().toISOString()
        };
        
        // Write memory data to its individual file
        await writeJsonFile(memoryFilePath, dataToStore);
        
        // Update the memory index
        const indexPath = path.join(memoryFolder, 'index.json');
        let index = await readJsonFile<{memories: {id: string, type: string, summary: string}[]}>(indexPath) || { memories: [] };
        
        // Get a short summary for the index
        const summary = memoryData.content ? 
            (memoryData.content.length > 100 ? 
                memoryData.content.substring(0, 97) + '...' : 
                memoryData.content) :
            (memoryData.summary || 'No content');
        
        // Add new entry to index
        index.memories.push({
            id: memoryId,
            type: memoryType,
            summary
        });
        
        // Sort memories by creation date (newest first)
        index.memories.sort((a, b) => {
            const idA = a.id.split('-')[1]; // Timestamp is the second part of the ID
            const idB = b.id.split('-')[1];
            return parseInt(idB) - parseInt(idA);
        });
        
        // Write updated index
        await writeJsonFile(indexPath, index);
        
        return memoryId;
    } catch (err) {
        traceError(`Error storing ${memoryType} memory:`, err);
        return null;
    }
}

/**
 * Update project state in the .tribe folder
 * @param projectFolder Project folder path
 * @param state New state to set
 */
export async function updateProjectState(
    projectFolder: string,
    state: 'initializing' | 'initialized' | 'active' | 'paused' | 'archived'
): Promise<boolean> {
    try {
        const tribeFolderPath = path.join(projectFolder, TRIBE_FOLDER);
        const projectFilePath = path.join(tribeFolderPath, 'project.json');
        
        // Read existing project data
        let projectData = await readJsonFile<Record<string, any>>(projectFilePath) || {};
        
        // Update state and timestamp
        projectData.state = state;
        projectData.lastModified = new Date().toISOString();
        
        // Set initialized flag if state is 'initialized'
        if (state === 'initialized') {
            projectData.initialized = true;
        }
        
        // Write updated project data
        return await writeJsonFile(projectFilePath, projectData);
    } catch (err: any) {
        traceError(`Error updating project state to ${state}:`, err);
        return false;
    }
}

/**
 * Get project metadata from the .tribe folder
 * @param projectFolder Project folder path
 */
export async function getProjectMetadata(projectFolder: string): Promise<any | null> {
    try {
        const tribeFolderPath = path.join(projectFolder, TRIBE_FOLDER);
        const projectFilePath = path.join(tribeFolderPath, 'project.json');
        
        return await readJsonFile(projectFilePath);
    } catch (err) {
        traceError('Error reading project metadata:', err);
        return null;
    }
}
