// Agent Tools for MightyDev
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { traceError, traceInfo, traceDebug } from './log/logging';

/**
 * Base Tool interface
 */
export interface Tool {
    name: string;
    description: string;
    usage: string;
    examples: string[];
    parameters: ToolParameter[];
    execute(params: Record<string, any>): Promise<any>;
}

/**
 * Tool parameter interface
 */
export interface ToolParameter {
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: any;
}

/**
 * File System Tool for reading, writing, and manipulating files
 */
export class FileSystemTool implements Tool {
    name = 'file_system';
    description = 'Tool for reading, writing, and manipulating files in the workspace';
    usage = 'Use this tool to read, write, or manipulate files in the workspace';
    examples = [
        'Read a file: { "action": "read", "path": "/path/to/file.txt" }',
        'Write a file: { "action": "write", "path": "/path/to/file.txt", "content": "Hello, world!" }',
        'Delete a file: { "action": "delete", "path": "/path/to/file.txt" }',
        'Create a directory: { "action": "mkdir", "path": "/path/to/directory" }',
        'List files in a directory: { "action": "list", "path": "/path/to/directory" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (read, write, delete, mkdir, list)',
            required: true
        },
        {
            name: 'path',
            type: 'string',
            description: 'The path to the file or directory',
            required: true
        },
        {
            name: 'content',
            type: 'string',
            description: 'The content to write to the file (for write action)',
            required: false
        }
    ];

    constructor(private readonly _workspaceRoot: string) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action, path: filePath, content } = params;
        const fullPath = this._resolveWorkspacePath(filePath);

        try {
            switch (action) {
                case 'read':
                    return await this._readFile(fullPath);
                case 'write':
                    return await this._writeFile(fullPath, content);
                case 'delete':
                    return await this._deleteFile(fullPath);
                case 'mkdir':
                    return await this._createDirectory(fullPath);
                case 'list':
                    return await this._listFiles(fullPath);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`FileSystemTool error:`, error);
            throw error;
        }
    }

    /**
     * Resolve a workspace-relative path to an absolute path
     */
    private _resolveWorkspacePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(this._workspaceRoot, filePath);
    }

    /**
     * Read a file
     */
    private async _readFile(filePath: string): Promise<any> {
        if (!await fs.pathExists(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const content = await fs.readFile(filePath, 'utf8');
        return { success: true, content };
    }

    /**
     * Write to a file
     */
    private async _writeFile(filePath: string, content: string): Promise<any> {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, 'utf8');
        return { success: true, path: filePath };
    }

    /**
     * Delete a file
     */
    private async _deleteFile(filePath: string): Promise<any> {
        if (!await fs.pathExists(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        await fs.remove(filePath);
        return { success: true, path: filePath };
    }

    /**
     * Create a directory
     */
    private async _createDirectory(dirPath: string): Promise<any> {
        await fs.ensureDir(dirPath);
        return { success: true, path: dirPath };
    }

    /**
     * List files in a directory
     */
    private async _listFiles(dirPath: string): Promise<any> {
        if (!await fs.pathExists(dirPath)) {
            throw new Error(`Directory not found: ${dirPath}`);
        }
        const stats = await fs.stat(dirPath);
        if (!stats.isDirectory()) {
            throw new Error(`Not a directory: ${dirPath}`);
        }
        const files = await fs.readdir(dirPath);
        const fileInfos = await Promise.all(files.map(async (file) => {
            const fullPath = path.join(dirPath, file);
            const stats = await fs.stat(fullPath);
            return {
                name: file,
                path: fullPath,
                isDirectory: stats.isDirectory(),
                size: stats.size,
                modified: stats.mtime
            };
        }));
        return { success: true, files: fileInfos };
    }
}

/**
 * Code Analysis Tool for analyzing and understanding code
 */
export class CodeAnalysisTool implements Tool {
    name = 'code_analysis';
    description = 'Tool for analyzing and understanding code in the workspace';
    usage = 'Use this tool to analyze, search, or understand code in the workspace';
    examples = [
        'Search for a pattern: { "action": "search", "pattern": "function foo", "include": "*.js" }',
        'Find definitions: { "action": "find_definition", "symbol": "MyClass", "include": "*.ts" }',
        'Find references: { "action": "find_references", "symbol": "doSomething", "include": "*.ts" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (search, find_definition, find_references)',
            required: true
        },
        {
            name: 'pattern',
            type: 'string',
            description: 'The pattern to search for (for search action)',
            required: false
        },
        {
            name: 'symbol',
            type: 'string',
            description: 'The symbol to find (for find_definition and find_references actions)',
            required: false
        },
        {
            name: 'include',
            type: 'string',
            description: 'File pattern to include in the search (e.g., "*.ts")',
            required: false,
            default: '*'
        },
        {
            name: 'exclude',
            type: 'string',
            description: 'File pattern to exclude from the search (e.g., "node_modules/**")',
            required: false,
            default: 'node_modules/**,**/node_modules/**,.git/**'
        }
    ];

    constructor(private readonly _workspaceRoot: string) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action, pattern, symbol, include, exclude } = params;

        try {
            switch (action) {
                case 'search':
                    return await this._searchCode(pattern, include, exclude);
                case 'find_definition':
                    return await this._findDefinition(symbol, include);
                case 'find_references':
                    return await this._findReferences(symbol, include);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`CodeAnalysisTool error:`, error);
            throw error;
        }
    }

    /**
     * Search for code patterns
     */
    private async _searchCode(pattern: string, include: string, exclude: string): Promise<any> {
        // This would use VS Code's search API in a real implementation
        // For now, we'll use a simple regex-based search as a placeholder
        
        const files = await this._findFiles(include, exclude);
        const results: any[] = [];
        
        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf8');
                const lines = content.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(pattern)) {
                        results.push({
                            file: path.relative(this._workspaceRoot, file),
                            line: i + 1,
                            text: lines[i]
                        });
                    }
                }
            } catch (error) {
                traceError(`Error reading file ${file}:`, error);
            }
        }
        
        return { success: true, results };
    }

    /**
     * Find definition of a symbol
     */
    private async _findDefinition(symbol: string, include: string): Promise<any> {
        // This would use VS Code's language server in a real implementation
        // For now, we'll use a simple regex-based search as a placeholder
        
        // Look for class, function, or variable definitions
        const patterns = [
            `class\\s+${symbol}\\b`, 
            `function\\s+${symbol}\\b`,
            `const\\s+${symbol}\\b`,
            `let\\s+${symbol}\\b`,
            `var\\s+${symbol}\\b`
        ];
        
        const files = await this._findFiles(include, '');
        const results: any[] = [];
        
        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf8');
                const lines = content.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    if (patterns.some(pattern => new RegExp(pattern).test(lines[i]))) {
                        results.push({
                            file: path.relative(this._workspaceRoot, file),
                            line: i + 1,
                            text: lines[i]
                        });
                    }
                }
            } catch (error) {
                traceError(`Error reading file ${file}:`, error);
            }
        }
        
        return { success: true, results };
    }

    /**
     * Find references to a symbol
     */
    private async _findReferences(symbol: string, include: string): Promise<any> {
        // This would use VS Code's language server in a real implementation
        // For now, we'll use a simple regex-based search as a placeholder
        
        // Simple word boundary search
        const pattern = `\\b${symbol}\\b`;
        
        const files = await this._findFiles(include, '');
        const results: any[] = [];
        
        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf8');
                const lines = content.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    if (new RegExp(pattern).test(lines[i])) {
                        results.push({
                            file: path.relative(this._workspaceRoot, file),
                            line: i + 1,
                            text: lines[i]
                        });
                    }
                }
            } catch (error) {
                traceError(`Error reading file ${file}:`, error);
            }
        }
        
        return { success: true, results };
    }

    /**
     * Find files matching a glob pattern
     */
    private async _findFiles(include: string, exclude: string): Promise<string[]> {
        // This is a simple implementation that would normally use VS Code's workspace.findFiles
        // For now, we'll use a recursive file search as a placeholder
        const includePattern = include || '*';
        const excludePattern = exclude ? exclude.split(',') : [];
        
        const getAllFiles = async (dir: string): Promise<string[]> => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const files = await Promise.all(entries.map(async (entry) => {
                const res = path.join(dir, entry.name);
                
                // Check against exclude patterns
                if (excludePattern.some(pattern => {
                    if (pattern.includes('*')) {
                        // Very basic glob matching
                        const regexPattern = pattern
                            .replace(/\./g, '\\.')
                            .replace(/\*\*/g, '.*')
                            .replace(/\*/g, '[^/]*');
                        return new RegExp(`^${regexPattern}$`).test(res);
                    }
                    return res.includes(pattern);
                })) {
                    return [];
                }
                
                return entry.isDirectory() ? await getAllFiles(res) : [res];
            }));
            return files.flat();
        };
        
        const allFiles = await getAllFiles(this._workspaceRoot);
        
        // Filter by include pattern
        return allFiles.filter(file => {
            // Very basic glob matching
            if (includePattern === '*') {
                return true;
            }
            if (includePattern.startsWith('*.')) {
                const ext = includePattern.substring(1);
                return file.endsWith(ext);
            }
            return file.includes(includePattern);
        });
    }
}

/**
 * Structured JSON Output Tool for enforcing structured outputs from models
 */
export class StructuredOutputTool implements Tool {
    name = 'structured_json_output';
    description = 'Tool for enforcing structured JSON outputs from models';
    usage = 'Use this tool to validate and enforce structured JSON outputs';
    examples = [
        'Validate JSON: { "action": "validate", "json": "{\"name\":\"John\",\"age\":30}", "schema": {"type":"object","properties":{"name":{"type":"string"},"age":{"type":"number"}}} }',
        'Extract JSON: { "action": "extract", "text": "The user\'s name is John and age is 30", "schema": {"type":"object","properties":{"name":{"type":"string"},"age":{"type":"number"}}} }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (validate, extract)',
            required: true
        },
        {
            name: 'json',
            type: 'string',
            description: 'The JSON string to validate (for validate action)',
            required: false
        },
        {
            name: 'text',
            type: 'string',
            description: 'The text to extract JSON from (for extract action)',
            required: false
        },
        {
            name: 'schema',
            type: 'object',
            description: 'The JSON schema to validate against',
            required: true
        }
    ];

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action, json, text, schema } = params;

        try {
            switch (action) {
                case 'validate':
                    return await this._validateJson(json, schema);
                case 'extract':
                    return await this._extractJson(text, schema);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`StructuredOutputTool error:`, error);
            throw error;
        }
    }

    /**
     * Validate JSON against a schema
     */
    private async _validateJson(jsonString: string, _schema: any): Promise<any> {
        try {
            const json = JSON.parse(jsonString);
            // In a real implementation, we would use a JSON schema validator
            // For now, we'll do a simple check
            return {
                success: true,
                valid: true,
                data: json
            };
        } catch (error) {
            return {
                success: false,
                valid: false,
                error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Extract JSON from text
     */
    private async _extractJson(text: string, _schema: any): Promise<any> {
        try {
            // In a real implementation, we would use a more sophisticated approach
            // For now, we'll look for JSON-like patterns in the text
            const matches = text.match(/\{[^}]+\}/g) || [];
            
            for (const match of matches) {
                try {
                    const json = JSON.parse(match);
                    return {
                        success: true,
                        extracted: true,
                        data: json
                    };
                } catch {
                    // Not valid JSON, continue
                }
            }
            
            return {
                success: false,
                extracted: false,
                error: 'No valid JSON found in text'
            };
        } catch (error) {
            return {
                success: false,
                extracted: false,
                error: `Error extracting JSON: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}

/**
 * Meta Data Tool for appending context to foundation model queries
 */
export class MetadataTool implements Tool {
    name = 'metadata';
    description = 'Tool for appending context to foundation model queries';
    usage = 'Use this tool to add metadata to prompts or messages';
    examples = [
        'Add agent metadata: { "action": "add_agent_metadata", "agent_id": "agent-123", "message": "How do I implement a sorting algorithm?" }',
        'Add task metadata: { "action": "add_task_metadata", "task_id": "task-456", "message": "Analyze this code for bugs" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (add_agent_metadata, add_task_metadata)',
            required: true
        },
        {
            name: 'agent_id',
            type: 'string',
            description: 'The ID of the agent (for add_agent_metadata action)',
            required: false
        },
        {
            name: 'task_id',
            type: 'string',
            description: 'The ID of the task (for add_task_metadata action)',
            required: false
        },
        {
            name: 'message',
            type: 'string',
            description: 'The message to add metadata to',
            required: true
        }
    ];

    constructor(
        private readonly _agents: Map<string, any> = new Map(),
        private readonly _tasks: Map<string, any> = new Map()
    ) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action, agent_id, task_id, message } = params;

        try {
            switch (action) {
                case 'add_agent_metadata':
                    return await this._addAgentMetadata(agent_id, message);
                case 'add_task_metadata':
                    return await this._addTaskMetadata(task_id, message);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`MetadataTool error:`, error);
            throw error;
        }
    }

    /**
     * Add agent metadata to a message
     */
    private async _addAgentMetadata(agentId: string, message: string): Promise<any> {
        const agent = this._agents.get(agentId);
        if (!agent) {
            return {
                success: false,
                error: `Agent with ID ${agentId} not found`
            };
        }

        // Build metadata string
        const metadata = `
            Agent Name: ${agent.name}
            Agent Role: ${agent.role}
            Agent Specialty: ${agent.specialty || 'None'}
            Communication Style: ${agent.communicationStyle || 'Professional'}
            Quirks: ${agent.quirks?.join(', ') || 'None'}
        `;

        return {
            success: true,
            message: message,
            metadata: metadata,
            enhanced_message: `${message}\n\nContext:\n${metadata}`
        };
    }

    /**
     * Add task metadata to a message
     */
    private async _addTaskMetadata(taskId: string, message: string): Promise<any> {
        const task = this._tasks.get(taskId);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${taskId} not found`
            };
        }

        // Build metadata string
        const metadata = `
            Task ID: ${taskId}
            Task Title: ${task.title}
            Task Description: ${task.description}
            Task Priority: ${task.priority}
            Task Status: ${task.status}
            Assigned To: ${task.assignee || 'Unassigned'}
        `;

        return {
            success: true,
            message: message,
            metadata: metadata,
            enhanced_message: `${message}\n\nTask Context:\n${metadata}`
        };
    }

    /**
     * Add an agent to the metadata tool
     */
    public addAgent(agentId: string, agentData: any): void {
        this._agents.set(agentId, agentData);
    }

    /**
     * Add a task to the metadata tool
     */
    public addTask(taskId: string, taskData: any): void {
        this._tasks.set(taskId, taskData);
    }
}