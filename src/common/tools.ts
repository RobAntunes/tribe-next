// Agent Tools for MightyDev
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as cp from 'child_process';
import * as crypto from 'crypto';
import { traceError, traceInfo, traceDebug } from './log/logging';
import * as diff from 'diff';
// We now have @types/diff installed, so this is not needed anymore

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
 * Shell Execution Tool for safely running shell commands
 * Provides secure command execution with output parsing and safety features
 */
export class ShellExecutionTool implements Tool {
    name = 'shell_execute';
    description = 'Execute shell commands safely with proper security constraints';
    private _workspaceRoot: string;

    usage = `Use this tool to:
- Execute shell commands in a controlled environment
- Get formatted output from command-line tools
- Run build, test, and development scripts
- Execute git commands
- Perform filesystem operations via shell commands`;

    examples = [
        '{ "action": "execute", "command": "ls -la", "cwd": "/path/to/directory" }',
        '{ "action": "execute", "command": "npm run build", "timeout": 30000 }',
        '{ "action": "execute", "command": "git status", "parse": "json" }',
        '{ "action": "execute", "command": "python -m pytest tests/", "timeout": 60000 }'
    ];

    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (execute)',
            required: true
        },
        {
            name: 'command',
            type: 'string',
            description: 'The shell command to execute',
            required: true
        },
        {
            name: 'cwd',
            type: 'string',
            description: 'The working directory for the command',
            required: false
        },
        {
            name: 'timeout',
            type: 'number',
            description: 'Timeout in milliseconds',
            required: false,
            default: 30000
        },
        {
            name: 'parse',
            type: 'string',
            description: 'Output parsing format (raw, lines, json)',
            required: false,
            default: 'raw'
        },
        {
            name: 'env',
            type: 'object',
            description: 'Additional environment variables as key-value pairs',
            required: false
        }
    ];

    // Allowed commands for security
    private _allowedCommands: Set<string> = new Set([
        // Development tools
        'npm', 'node', 'python', 'python3', 'pip', 'pip3', 
        'yarn', 'pnpm', 'gradle', 'mvn', 'mvnw',
        
        // Version control
        'git', 'svn', 'hg',
        
        // Build tools
        'make', 'cmake', 'cargo', 'dotnet',
        
        // File operations
        'ls', 'dir', 'find', 'grep', 'cat', 'head', 'tail',
        
        // Directory operations
        'mkdir', 'rmdir', 'cd', 'pwd', 'cp', 'mv', 'rm'
    ]);

    // Blocked patterns for security
    private _blockedPatterns: RegExp[] = [
        /sudo/,
        /su\s+-/,
        /rm\s+(-rf?|--recursive)\s+\//,
        />\s*\/dev\/(null|sd[a-z])/,
        /\|\s*(bash|sh|zsh)/,
        /curl\s+.*\s*\|\s*(bash|sh|zsh)/,
        /wget\s+.*\s*\|\s*(bash|sh|zsh)/,
        /chmod\s+777/,
        /chown\s+.*\s+\/\w+/
    ];

    constructor(workspaceRoot: string) {
        this._workspaceRoot = workspaceRoot;
    }

    async execute(params: Record<string, any>): Promise<any> {
        const { action, command, cwd, timeout = 30000, parse = 'raw', env = {} } = params;
        
        if (action !== 'execute') {
            return { error: `Unknown action: ${action}. Only 'execute' is supported.` };
        }
        
        if (!command || typeof command !== 'string') {
            return { error: 'Command is required and must be a string' };
        }
        
        // Perform security validation
        const securityCheck = this._validateCommand(command);
        if (!securityCheck.safe) {
            return { 
                error: `Command rejected: ${securityCheck.reason}`,
                command
            };
        }
        
        try {
            // Resolve working directory
            const workingDir = cwd 
                ? this._resolveWorkspacePath(cwd)
                : this._workspaceRoot;
            
            // Execute command
            const result = await this._executeCommand(command, {
                cwd: workingDir,
                timeout,
                env: { ...process.env, ...env }
            });
            
            // Parse output if requested
            let parsedOutput;
            switch (parse) {
                case 'lines':
                    parsedOutput = result.stdout.split('\n').filter(line => line.trim().length > 0);
                    break;
                case 'json':
                    try {
                        parsedOutput = JSON.parse(result.stdout);
                    } catch (e) {
                        parsedOutput = {
                            error: 'Failed to parse command output as JSON',
                            rawOutput: result.stdout
                        };
                    }
                    break;
                case 'raw':
                default:
                    parsedOutput = result.stdout;
            }
            
            return {
                success: true,
                command,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                output: parsedOutput,
                executionTime: result.executionTime
            };
        } catch (error) {
            traceError(`Error executing shell command: ${error}`);
            return {
                error: String(error),
                command
            };
        }
    }

    /**
     * Validate a command for security concerns
     */
    private _validateCommand(command: string): { safe: boolean, reason?: string } {
        // Split command to get the base command
        const trimmedCommand = command.trim();
        const parts = trimmedCommand.split(/\s+/);
        const baseCommand = parts[0];
        
        // Check if command is explicitly allowed
        if (!this._allowedCommands.has(baseCommand)) {
            return {
                safe: false,
                reason: `Command '${baseCommand}' is not in the allowed list for security reasons`
            };
        }
        
        // Check for blocked patterns
        for (const pattern of this._blockedPatterns) {
            if (pattern.test(trimmedCommand)) {
                return {
                    safe: false,
                    reason: `Command contains a blocked pattern: ${pattern}`
                };
            }
        }
        
        // Check for suspicious path traversal
        if (trimmedCommand.includes('..') && (
            trimmedCommand.includes('cd ') || 
            trimmedCommand.includes('rm ') || 
            trimmedCommand.includes('cp ') || 
            trimmedCommand.includes('mv ')
        )) {
            return {
                safe: false,
                reason: 'Command contains suspicious parent directory traversal'
            };
        }
        
        return { safe: true };
    }

    /**
     * Execute a shell command with proper error handling
     */
    private _executeCommand(command: string, options: {
        cwd?: string;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
    }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        executionTime: number;
    }> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            
            traceInfo(`Executing command: ${command} in ${options.cwd}`);
            
            const childProcess = cp.exec(command, {
                cwd: options.cwd,
                env: options.env,
                timeout: options.timeout
            });
            
            childProcess.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
            
            childProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });
            
            childProcess.on('error', (error: Error) => {
                traceError(`Command execution error: ${error.message}`);
                reject(error);
            });
            
            childProcess.on('exit', (code: number | null) => {
                const executionTime = Date.now() - startTime;
                traceInfo(`Command completed in ${executionTime}ms with exit code ${code}`);
                
                resolve({
                    stdout,
                    stderr,
                    exitCode: code !== null ? code : -1,
                    executionTime
                });
            });
        });
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
}

/**
 * Enhanced Code Diff Tool for comprehensive code comparison, diffing, and patching
 * Provides advanced diffing capabilities with structured output and visualization
 */
export class CodeDiffTool implements Tool {
    name = 'code_diff';
    description = 'Advanced code diffing, comparison, and patch application tool';
    private _workspaceRoot: string;

    usage = `Use this tool to:
- Compare code between two files or strings
- Generate detailed, structured diffs with context
- Apply patches to files
- Visualize changes in a human-readable format
- Generate unified or split diffs
- Analyze semantic changes in code`;

    examples = [
        '{ "action": "compare_files", "file1": "path/to/file1.ts", "file2": "path/to/file2.ts" }',
        '{ "action": "generate_diff", "original": "function foo() {\\n  return 1;\\n}", "modified": "function foo() {\\n  return 2;\\n}" }',
        '{ "action": "apply_patch", "target": "path/to/file.ts", "patch": "@@ -1,3 +1,3 @@\\n function foo() {\\n-  return 1;\\n+  return 2;\\n }" }',
        '{ "action": "visualize_changes", "file": "path/to/file.ts", "before": "commit1", "after": "commit2" }',
        '{ "action": "analyze_impact", "diff": "patch content", "scope": "function" }'
    ];

    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The diff action to perform (compare_files, generate_diff, apply_patch, visualize_changes, analyze_impact)',
            required: true
        },
        {
            name: 'file1',
            type: 'string',
            description: 'First file path for comparison',
            required: false
        },
        {
            name: 'file2',
            type: 'string',
            description: 'Second file path for comparison',
            required: false
        },
        {
            name: 'original',
            type: 'string',
            description: 'Original content for diff generation',
            required: false
        },
        {
            name: 'modified',
            type: 'string',
            description: 'Modified content for diff generation',
            required: false
        },
        {
            name: 'target',
            type: 'string',
            description: 'Target file to apply patch to',
            required: false
        },
        {
            name: 'patch',
            type: 'string',
            description: 'Patch content to apply',
            required: false
        },
        {
            name: 'format',
            type: 'string',
            description: 'Output format (unified, split, json, html)',
            required: false,
            default: 'unified'
        },
        {
            name: 'context_lines',
            type: 'number',
            description: 'Number of context lines to include',
            required: false,
            default: 3
        }
    ];

    constructor(workspaceRoot: string) {
        this._workspaceRoot = workspaceRoot;
    }

    async execute(params: Record<string, any>): Promise<any> {
        const { action } = params;
        
        try {
            switch (action) {
                case 'compare_files':
                    return await this._compareFiles(params.file1, params.file2, params.format, params.context_lines);
                case 'generate_diff':
                    return await this._generateDiff(params.original, params.modified, params.format, params.context_lines);
                case 'apply_patch':
                    return await this._applyPatch(params.target, params.patch);
                case 'visualize_changes':
                    return await this._visualizeChanges(params.file, params.before, params.after, params.format);
                case 'analyze_impact':
                    return await this._analyzeImpact(params.diff, params.scope);
                default:
                    return { error: `Unknown action: ${action}` };
            }
        } catch (error) {
            traceError(`Error in CodeDiffTool: ${error}`);
            return { error: String(error) };
        }
    }

    /**
     * Compare two files and generate a structured diff
     */
    private async _compareFiles(file1Path: string, file2Path: string, format: string = 'unified', contextLines: number = 3): Promise<any> {
        try {
            // Resolve paths
            const resolvedFile1 = this._resolveWorkspacePath(file1Path);
            const resolvedFile2 = this._resolveWorkspacePath(file2Path);
            
            // Read file contents
            const file1Content = await fs.readFile(resolvedFile1, 'utf-8');
            const file2Content = await fs.readFile(resolvedFile2, 'utf-8');
            
            // Generate diff
            return this._generateDiff(file1Content, file2Content, format, contextLines, {
                file1: file1Path,
                file2: file2Path
            });
        } catch (error) {
            traceError(`Error comparing files: ${error}`);
            return { error: `Failed to compare files: ${error}` };
        }
    }

    /**
     * Generate a diff between original and modified content
     */
    private async _generateDiff(original: string, modified: string, format: string = 'unified', contextLines: number = 3, metadata?: any): Promise<any> {
        try {
            // Split content into lines
            const originalLines = original.split('\n');
            const modifiedLines = modified.split('\n');
            
            // Create diff patches
            const patches = diff.createPatch(
                metadata?.file1 || 'original',
                original,
                modified,
                metadata?.file2 || 'modified',
                '',
                { context: contextLines }
            );
            
            // Parse the changes for structured output
            const changes = this._parseChanges(original, modified);
            
            // Format output based on requested format
            let formattedOutput;
            switch (format) {
                case 'unified':
                    formattedOutput = patches;
                    break;
                case 'split':
                    formattedOutput = this._generateSplitView(originalLines, modifiedLines, changes);
                    break;
                case 'json':
                    formattedOutput = changes;
                    break;
                case 'html':
                    formattedOutput = this._generateHtmlDiff(original, modified);
                    break;
                default:
                    formattedOutput = patches;
            }
            
            return {
                success: true,
                diff: formattedOutput,
                metadata: {
                    ...metadata,
                    originalLines: originalLines.length,
                    modifiedLines: modifiedLines.length,
                    additions: changes.filter(c => c.type === 'add').length,
                    deletions: changes.filter(c => c.type === 'remove').length,
                    modifications: changes.filter(c => c.type === 'change').length
                },
                format,
                summary: this._generateDiffSummary(changes)
            };
        } catch (error) {
            traceError(`Error generating diff: ${error}`);
            return { error: `Failed to generate diff: ${error}` };
        }
    }

    /**
     * Apply a patch to a file
     */
    private async _applyPatch(targetPath: string, patch: string): Promise<any> {
        try {
            // Resolve target path
            const resolvedTarget = this._resolveWorkspacePath(targetPath);
            
            // Read target file
            const targetContent = await fs.readFile(resolvedTarget, 'utf-8');
            
            // Apply patch
            const patchedContent = diff.applyPatch(targetContent, patch);
            
            // Write patched content back to file
            await fs.writeFile(resolvedTarget, patchedContent);
            
            return {
                success: true,
                message: `Successfully applied patch to ${targetPath}`,
                patchedFile: targetPath
            };
        } catch (error) {
            traceError(`Error applying patch: ${error}`);
            return { error: `Failed to apply patch: ${error}` };
        }
    }

    /**
     * Visualize changes between versions of a file 
     */
    private async _visualizeChanges(filePath: string, before: string, after: string, format: string = 'unified'): Promise<any> {
        try {
            // This could use git history or VSCode's file history API in a real implementation
            // For now, we'll assume before/after are content strings directly
            
            return this._generateDiff(before, after, format, 3, {
                file: filePath,
                beforeVersion: before.substring(0, 7),
                afterVersion: after.substring(0, 7)
            });
        } catch (error) {
            traceError(`Error visualizing changes: ${error}`);
            return { error: `Failed to visualize changes: ${error}` };
        }
    }

    /**
     * Analyze the impact of changes
     */
    private async _analyzeImpact(diffContent: string, scope: string = 'file'): Promise<any> {
        try {
            // In a real implementation, this would use AST analysis to understand
            // semantic changes. For now, we'll provide a simple analysis.
            
            const addedLines = (diffContent.match(/^\+(?![\+\-])/gm) || []).length;
            const removedLines = (diffContent.match(/^\-(?![\+\-])/gm) || []).length;
            
            // Extract function/class names that were modified
            const modifiedEntities = this._extractModifiedEntities(diffContent);
            
            // Calculate risk based on ratio of changes
            const changeRatio = (addedLines + removedLines) / diffContent.split('\n').length;
            let risk = 'low';
            if (changeRatio > 0.7) risk = 'high';
            else if (changeRatio > 0.3) risk = 'medium';
            
            return {
                success: true,
                impact: {
                    addedLines,
                    removedLines,
                    netChange: addedLines - removedLines,
                    modifiedEntities,
                    risk,
                    scope
                },
                recommendations: this._generateRecommendations(modifiedEntities, risk)
            };
        } catch (error) {
            traceError(`Error analyzing impact: ${error}`);
            return { error: `Failed to analyze impact: ${error}` };
        }
    }

    /**
     * Generate split view diff
     */
    private _generateSplitView(originalLines: string[], modifiedLines: string[], changes: any[]): any {
        // Create a structured split view format
        const splitView: any[] = [];
        let originalIdx = 0;
        let modifiedIdx = 0;
        
        changes.forEach(change => {
            if (change.type === 'context') {
                // Add context lines
                for (let i = 0; i < change.count; i++) {
                    splitView.push({
                        type: 'context',
                        original: {
                            line: originalIdx + 1,
                            content: originalLines[originalIdx]
                        },
                        modified: {
                            line: modifiedIdx + 1,
                            content: modifiedLines[modifiedIdx]
                        }
                    });
                    originalIdx++;
                    modifiedIdx++;
                }
            } else if (change.type === 'add') {
                // Add added lines
                splitView.push({
                    type: 'add',
                    original: null,
                    modified: {
                        line: modifiedIdx + 1,
                        content: modifiedLines[modifiedIdx]
                    }
                });
                modifiedIdx++;
            } else if (change.type === 'remove') {
                // Add removed lines
                splitView.push({
                    type: 'remove',
                    original: {
                        line: originalIdx + 1,
                        content: originalLines[originalIdx]
                    },
                    modified: null
                });
                originalIdx++;
            } else if (change.type === 'change') {
                // Add changed lines
                splitView.push({
                    type: 'change',
                    original: {
                        line: originalIdx + 1,
                        content: originalLines[originalIdx]
                    },
                    modified: {
                        line: modifiedIdx + 1,
                        content: modifiedLines[modifiedIdx]
                    }
                });
                originalIdx++;
                modifiedIdx++;
            }
        });
        
        return splitView;
    }

    /**
     * Generate HTML diff for visual display
     */
    private _generateHtmlDiff(original: string, modified: string): string {
        // This would generate HTML with nice syntax highlighting in a real implementation
        // For now, we'll return a simple HTML representation
        const changes = diff.diffLines(original, modified);
        
        let html = '<div class="diff-container">\n';
        
        changes.forEach(part => {
            const type = part.added ? 'addition' : part.removed ? 'deletion' : 'context';
            const colorClass = part.added ? 'diff-add' : part.removed ? 'diff-remove' : '';
            
            html += `<div class="diff-block ${colorClass}">\n`;
            part.value.split('\n').forEach(line => {
                if (line === '') return;
                const prefix = part.added ? '+' : part.removed ? '-' : ' ';
                html += `<div class="diff-line">${prefix} ${this._escapeHtml(line)}</div>\n`;
            });
            html += '</div>\n';
        });
        
        html += '</div>';
        return html;
    }

    /**
     * Parse changes between two strings
     */
    private _parseChanges(original: string, modified: string): any[] {
        const changes: any[] = [];
        const diffResult = diff.diffLines(original, modified);
        
        diffResult.forEach(part => {
            if (part.added) {
                changes.push({
                    type: 'add',
                    content: part.value,
                    count: part.count
                });
            } else if (part.removed) {
                changes.push({
                    type: 'remove',
                    content: part.value,
                    count: part.count
                });
            } else {
                changes.push({
                    type: 'context',
                    content: part.value,
                    count: part.count
                });
            }
        });
        
        return changes;
    }

    /**
     * Generate a human-readable summary of changes
     */
    private _generateDiffSummary(changes: any[]): string {
        const additions = changes.filter(c => c.type === 'add').reduce((sum, c) => sum + c.count, 0);
        const deletions = changes.filter(c => c.type === 'remove').reduce((sum, c) => sum + c.count, 0);
        
        let summary = `${additions} addition${additions !== 1 ? 's' : ''} and ${deletions} deletion${deletions !== 1 ? 's' : ''}`;
        
        // Analyze the changes to identify patterns
        const modifiedEntities = this._extractModifiedEntitiesFromChanges(changes);
        if (modifiedEntities.length > 0) {
            summary += `. Modified: ${modifiedEntities.join(', ')}`;
        }
        
        return summary;
    }

    /**
     * Extract modified entities (functions, classes) from a diff
     */
    private _extractModifiedEntities(diffContent: string): string[] {
        const entities: string[] = [];
        const functionRegex = /[\+\-]\s*(function|class|const|let|var)\s+(\w+)/g;
        let match;
        
        while ((match = functionRegex.exec(diffContent)) !== null) {
            entities.push(`${match[1]} ${match[2]}`);
        }
        
        return [...new Set(entities)]; // Remove duplicates
    }

    /**
     * Extract modified entities from changes array
     */
    private _extractModifiedEntitiesFromChanges(changes: any[]): string[] {
        const entities: string[] = [];
        const relevantChanges = changes.filter(c => c.type === 'add' || c.type === 'remove');
        
        relevantChanges.forEach(change => {
            const functionRegex = /(function|class|const|let|var)\s+(\w+)/g;
            let match;
            
            while ((match = functionRegex.exec(change.content)) !== null) {
                entities.push(`${match[1]} ${match[2]}`);
            }
        });
        
        return [...new Set(entities)]; // Remove duplicates
    }

    /**
     * Generate recommendations based on changes
     */
    private _generateRecommendations(modifiedEntities: string[], risk: string): string[] {
        const recommendations: string[] = [];
        
        if (risk === 'high') {
            recommendations.push('Consider breaking down this large change into smaller, more focused commits');
            recommendations.push('Ensure comprehensive tests are in place for the modified components');
        }
        
        if (modifiedEntities.length > 3) {
            recommendations.push('Changes affect multiple entities - ensure all interactions are tested');
        }
        
        if (modifiedEntities.some(e => e.includes('class'))) {
            recommendations.push('Class modifications detected - check for impacts on inheritance/implementations');
        }
        
        // Add generic recommendations if none specific
        if (recommendations.length === 0) {
            recommendations.push('No specific concerns detected - standard code review recommended');
        }
        
        return recommendations;
    }

    /**
     * Escape HTML special characters
     */
    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
        'Find references: { "action": "find_references", "symbol": "doSomething", "include": "*.ts" }',
        'Generate diff: { "action": "generate_diff", "oldContent": "function foo() {}", "newContent": "function foo() { return true; }" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (search, find_definition, find_references, generate_diff)',
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
            name: 'oldContent',
            type: 'string',
            description: 'The original content (for generate_diff action)',
            required: false
        },
        {
            name: 'newContent',
            type: 'string',
            description: 'The new content (for generate_diff action)',
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
        const { action, pattern, symbol, oldContent, newContent, include, exclude } = params;

        try {
            switch (action) {
                case 'search':
                    return await this._searchCode(pattern, include, exclude);
                case 'find_definition':
                    return await this._findDefinition(symbol, include);
                case 'find_references':
                    return await this._findReferences(symbol, include);
                case 'generate_diff':
                    return await this._generateDiff(oldContent, newContent);
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
     * Generate a diff between old and new content
     */
    private async _generateDiff(oldContent: string, newContent: string): Promise<any> {
        try {
            // Use the diff library to generate a unified diff
            const changes = diff.createPatch(
                'code.txt',
                oldContent || '',
                newContent || '',
                'Previous',
                'Current'
            );
            
            // Also generate an HTML representation for display
            const htmlDiff = this._diffToHtml(oldContent || '', newContent || '');
            
            return {
                success: true,
                diff: changes,
                html: htmlDiff,
                hasChanges: oldContent !== newContent
            };
        } catch (error) {
            traceError(`Error generating diff:`, error);
            return {
                success: false,
                error: `Error generating diff: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Convert a diff to HTML for display
     */
    private _diffToHtml(oldContent: string, newContent: string): string {
        const diffParts = diff.diffLines(oldContent, newContent);
        let html = '<div class="diff-container">';
        
        diffParts.forEach((part: any) => {
            const className = part.added 
                ? 'diff-added' 
                : part.removed 
                    ? 'diff-removed' 
                    : 'diff-unchanged';
            
            const diffHtml = `<div class="${className}">${this._escapeHtml(part.value)}</div>`;
            html += diffHtml;
        });
        
        html += '</div>';
        return html;
    }
    
    /**
     * Escape HTML special characters
     */
    private _escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

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
        'Extract JSON: { "action": "extract", "text": "The user\'s name is John and age is 30", "schema": {"type":"object","properties":{"name":{"type":"string"},"age":{"type":"number"}}} }',
        'Extract code blocks: { "action": "extract_code_blocks", "text": "Here\'s a solution: ```javascript\\nfunction hello() { return \\"world\\"; }\\n```" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (validate, extract, extract_code_blocks)',
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
            description: 'The text to extract JSON or code blocks from',
            required: false
        },
        {
            name: 'schema',
            type: 'object',
            description: 'The JSON schema to validate against',
            required: false
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
                case 'extract_code_blocks':
                    return await this._extractCodeBlocks(text);
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
    
    /**
     * Extract code blocks from markdown text
     */
    private async _extractCodeBlocks(text: string): Promise<any> {
        try {
            // Look for code blocks in markdown format (```language\ncode\n```)
            const codeBlockRegex = /```(?:([a-zA-Z0-9_-]+))?\n([\s\S]*?)```/g;
            const codeBlocks: Array<{language: string, code: string, index: number}> = [];
            
            let match;
            while ((match = codeBlockRegex.exec(text)) !== null) {
                const language = match[1] || 'plaintext';
                const code = match[2].trim();
                const index = match.index;
                
                if (code) {
                    codeBlocks.push({
                        language,
                        code,
                        index
                    });
                }
            }
            
            if (codeBlocks.length > 0) {
                return {
                    success: true,
                    extracted: true,
                    codeBlocks
                };
            }
            
            // If no code blocks were found with the markdown format, look for indented code
            const indentedCodeRegex = /(?:^|\n)( {4}|\t)(.+)(?:\n|$)/g;
            const indentedBlocks: Array<{code: string, index: number}> = [];
            
            while ((match = indentedCodeRegex.exec(text)) !== null) {
                const code = match[2].trim();
                const index = match.index;
                
                if (code) {
                    indentedBlocks.push({
                        code,
                        index
                    });
                }
            }
            
            if (indentedBlocks.length > 0) {
                return {
                    success: true,
                    extracted: true,
                    codeBlocks: indentedBlocks.map(block => ({
                        language: 'plaintext',
                        code: block.code,
                        index: block.index
                    }))
                };
            }
            
            return {
                success: false,
                extracted: false,
                error: 'No code blocks found in text'
            };
        } catch (error) {
            return {
                success: false,
                extracted: false,
                error: `Error extracting code blocks: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}

/**
 * Code Generation Tool for automated code generation
 */
export class CodeGenerationTool implements Tool {
    name = 'code_generation';
    description = 'Tool for code generation using AI';
    usage = 'Use this tool to generate code based on descriptions or requirements';
    examples = [
        'Generate function: { "action": "generate_function", "language": "javascript", "description": "A function that adds two numbers and returns the sum" }',
        'Generate class: { "action": "generate_class", "language": "python", "description": "A User class with name, email properties and a validation method" }',
        'Generate solution: { "action": "generate_solution", "language": "typescript", "description": "Implementation of binary search algorithm" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (generate_function, generate_class, generate_solution)',
            required: true
        },
        {
            name: 'language',
            type: 'string',
            description: 'The target programming language (javascript, typescript, python, etc.)',
            required: true
        },
        {
            name: 'description',
            type: 'string',
            description: 'The description of what to generate',
            required: true
        },
        {
            name: 'context',
            type: 'string',
            description: 'Additional context, such as existing code or related classes',
            required: false
        }
    ];

    constructor(private readonly _workspaceRoot: string) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action, language, description, context } = params;

        try {
            // In a real implementation, this would call an AI model API
            // For demo purposes, we'll just simulate the generation
            
            let generatedCode = '';
            
            switch (language.toLowerCase()) {
                case 'javascript':
                    if (action === 'generate_function') {
                        generatedCode = `/**
 * ${description}
 */
function generatedFunction(a, b) {
  // Implementation based on description
  return a + b;
}`;
                    } else if (action === 'generate_class') {
                        generatedCode = `/**
 * ${description}
 */
class GeneratedClass {
  constructor(properties) {
    this.properties = properties;
  }
  
  method() {
    // Method implementation
    return this.properties;
  }
}`;
                    } else if (action === 'generate_solution') {
                        generatedCode = `/**
 * ${description}
 */
function solution(array, target) {
  // Implementation of solution
  let left = 0;
  let right = array.length - 1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (array[mid] === target) {
      return mid;
    }
    if (array[mid] < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  
  return -1;
}`;
                    }
                    break;
                    
                case 'typescript':
                    if (action === 'generate_function') {
                        generatedCode = `/**
 * ${description}
 */
function generatedFunction(a: number, b: number): number {
  // Implementation based on description
  return a + b;
}`;
                    } else if (action === 'generate_class') {
                        generatedCode = `/**
 * ${description}
 */
class GeneratedClass {
  private properties: any;
  
  constructor(properties: any) {
    this.properties = properties;
  }
  
  public method(): any {
    // Method implementation
    return this.properties;
  }
}`;
                    } else if (action === 'generate_solution') {
                        generatedCode = `/**
 * ${description}
 */
function solution(array: number[], target: number): number {
  // Implementation of solution
  let left = 0;
  let right = array.length - 1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (array[mid] === target) {
      return mid;
    }
    if (array[mid] < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  
  return -1;
}`;
                    }
                    break;
                    
                case 'python':
                    if (action === 'generate_function') {
                        generatedCode = `# ${description}
def generated_function(a, b):
    # Implementation based on description
    return a + b`;
                    } else if (action === 'generate_class') {
                        generatedCode = `# ${description}
class GeneratedClass:
    def __init__(self, properties):
        self.properties = properties
    
    def method(self):
        # Method implementation
        return self.properties`;
                    } else if (action === 'generate_solution') {
                        generatedCode = `# ${description}
def solution(array, target):
    # Implementation of solution
    left = 0
    right = len(array) - 1
    
    while left <= right:
        mid = (left + right) // 2
        if array[mid] == target:
            return mid
        if array[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    
    return -1`;
                    }
                    break;
                    
                default:
                    return {
                        success: false,
                        error: `Unsupported language: ${language}`
                    };
            }
            
            return {
                success: true,
                code: generatedCode,
                language,
                action
            };
            
        } catch (error) {
            traceError(`CodeGenerationTool error:`, error);
            return {
                success: false,
                error: `Error generating code: ${error instanceof Error ? error.message : String(error)}`
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

/**
 * Message interface
 */
export interface Message {
    id: string;
    from: string;
    to: string | string[];
    content: string;
    timestamp: string;
    threadId?: string;
    parentId?: string;
    attachments?: Attachment[];
    metadata?: Record<string, any>;
    isTeamMessage?: boolean;
    reactions?: MessageReaction[];
    isTyping?: boolean;
}

/**
 * Message thread interface
 */
export interface MessageThread {
    id: string;
    title: string;
    participants: string[];
    messages: Message[];
    createdAt: string;
    lastActivity: string;
    metadata?: Record<string, any>;
}

/**
 * Attachment interface
 */
export interface Attachment {
    id: string;
    type: 'file' | 'code' | 'image' | 'link';
    name: string;
    content?: string; // For code snippets or small files
    url?: string; // For links or larger files
    language?: string; // For code snippets
    metadata?: Record<string, any>;
}

/**
 * Message reaction interface
 */
export interface MessageReaction {
    emoji: string;
    count: number;
    users: string[];
}

/**
 * Task interface for project management
 */
export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
    priority: 'low' | 'medium' | 'high' | 'critical';
    assignee?: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    due_date?: string;
    parent_task_id?: string;
    subtasks?: string[];
    tags?: string[];
    dependencies?: string[];
    metadata?: Record<string, any>;
    execution_mode?: 'synchronous' | 'asynchronous' | 'parallel' | 'concurrent';
}

/**
 * Project interface for project management
 */
export interface Project {
    id: string;
    name: string;
    description: string;
    status: 'planning' | 'active' | 'on_hold' | 'completed';
    created_at: string;
    updated_at: string;
    tasks: string[];
    teams: string[];
    metadata?: Record<string, any>;
}

/**
 * Team interface for project management
 */
export interface Team {
    id: string;
    name: string;
    description: string;
    members: string[];
    created_at: string;
    updated_at: string;
    lead_id?: string;
    metadata?: Record<string, any>;
}

/**
 * Project Management Tool for managing projects, tasks, and teams
 */
export class ProjectManagementTool implements Tool {
    name = 'project_management';
    description = 'Tool for managing projects, tasks, and teams';
    usage = 'Use this tool to create and manage projects, tasks, and teams';
    examples = [
        'Create task: { "action": "create_task", "project_id": "project-123", "title": "Implement authentication", "description": "Add user login and registration", "priority": "high" }',
        'Update task: { "action": "update_task", "task_id": "task-456", "status": "in_progress", "assignee": "agent-789" }',
        'Get task: { "action": "get_task", "task_id": "task-456" }',
        'List tasks: { "action": "list_tasks", "project_id": "project-123", "status": "todo" }',
        'Create project: { "action": "create_project", "name": "E-commerce Platform", "description": "Build an online store" }',
        'Add team member: { "action": "add_team_member", "team_id": "team-123", "member_id": "agent-456" }',
        'Create subtask: { "action": "create_subtask", "parent_task_id": "task-123", "title": "Write unit tests", "description": "Create tests for login functionality" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (create_task, update_task, get_task, list_tasks, create_project, update_project, get_project, list_projects, create_team, update_team, get_team, list_teams, add_team_member, remove_team_member, create_subtask, update_task_status, assign_task, set_task_dependencies)',
            required: true
        },
        {
            name: 'task_id',
            type: 'string',
            description: 'The ID of the task to get, update, or delete',
            required: false
        },
        {
            name: 'project_id',
            type: 'string',
            description: 'The ID of the project',
            required: false
        },
        {
            name: 'team_id',
            type: 'string',
            description: 'The ID of the team',
            required: false
        },
        {
            name: 'title',
            type: 'string',
            description: 'The title of the task or project',
            required: false
        },
        {
            name: 'description',
            type: 'string',
            description: 'The description of the task, project, or team',
            required: false
        },
        {
            name: 'status',
            type: 'string',
            description: 'The status of the task or project',
            required: false
        },
        {
            name: 'priority',
            type: 'string',
            description: 'The priority of the task (low, medium, high, critical)',
            required: false
        },
        {
            name: 'assignee',
            type: 'string',
            description: 'The ID of the agent assigned to the task',
            required: false
        },
        {
            name: 'name',
            type: 'string',
            description: 'The name of the project or team',
            required: false
        },
        {
            name: 'member_id',
            type: 'string',
            description: 'The ID of the team member to add or remove',
            required: false
        },
        {
            name: 'parent_task_id',
            type: 'string',
            description: 'The ID of the parent task when creating a subtask',
            required: false
        },
        {
            name: 'due_date',
            type: 'string',
            description: 'The due date for the task (ISO format)',
            required: false
        },
        {
            name: 'tags',
            type: 'array',
            description: 'Tags for the task',
            required: false
        },
        {
            name: 'dependencies',
            type: 'array',
            description: 'IDs of tasks that this task depends on',
            required: false
        },
        {
            name: 'execution_mode',
            type: 'string',
            description: 'The execution mode for the task (synchronous, asynchronous, parallel, concurrent)',
            required: false
        },
        {
            name: 'metadata',
            type: 'object',
            description: 'Additional metadata for the task, project, or team',
            required: false
        }
    ];

    // Storage for projects, tasks, and teams
    private _projects: Map<string, Project> = new Map();
    private _tasks: Map<string, Task> = new Map();
    private _teams: Map<string, Team> = new Map();

    constructor(private readonly _storageRoot: string, private readonly _currentAgent: string) {
        this._loadState();
    }

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action } = params;

        try {
            switch (action) {
                // Task-related actions
                case 'create_task':
                    return await this._createTask(params);
                case 'update_task':
                    return await this._updateTask(params);
                case 'get_task':
                    return await this._getTask(params.task_id);
                case 'list_tasks':
                    return await this._listTasks(params.project_id, params.status, params.assignee);
                case 'update_task_status':
                    return await this._updateTaskStatus(params.task_id, params.status);
                case 'assign_task':
                    return await this._assignTask(params.task_id, params.assignee);
                case 'create_subtask':
                    return await this._createSubtask(params);
                case 'set_task_dependencies':
                    return await this._setTaskDependencies(params.task_id, params.dependencies);
                
                // Project-related actions
                case 'create_project':
                    return await this._createProject(params);
                case 'update_project':
                    return await this._updateProject(params);
                case 'get_project':
                    return await this._getProject(params.project_id);
                case 'list_projects':
                    return await this._listProjects(params.status);
                
                // Team-related actions
                case 'create_team':
                    return await this._createTeam(params);
                case 'update_team':
                    return await this._updateTeam(params);
                case 'get_team':
                    return await this._getTeam(params.team_id);
                case 'list_teams':
                    return await this._listTeams();
                case 'add_team_member':
                    return await this._addTeamMember(params.team_id, params.member_id);
                case 'remove_team_member':
                    return await this._removeTeamMember(params.team_id, params.member_id);
                
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`ProjectManagementTool error:`, error);
            throw error;
        }
    }

    /**
     * Create a new task
     */
    private async _createTask(params: Record<string, any>): Promise<any> {
        const { 
            project_id, title, description, status = 'todo', 
            priority = 'medium', assignee, due_date, tags, 
            dependencies, execution_mode, metadata 
        } = params;

        if (!project_id) {
            return {
                success: false,
                error: 'Project ID is required'
            };
        }

        if (!title) {
            return {
                success: false,
                error: 'Task title is required'
            };
        }

        // Validate project exists
        const project = this._projects.get(project_id);
        if (!project) {
            return {
                success: false,
                error: `Project with ID ${project_id} not found`
            };
        }

        // Create task
        const now = new Date().toISOString();
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const task: Task = {
            id: taskId,
            title,
            description: description || '',
            status: (status as 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'),
            priority: (priority as 'low' | 'medium' | 'high' | 'critical'),
            assignee: assignee || undefined,
            created_by: this._currentAgent,
            created_at: now,
            updated_at: now,
            due_date: due_date,
            tags: tags || [],
            dependencies: dependencies || [],
            execution_mode: execution_mode as 'synchronous' | 'asynchronous' | 'parallel' | 'concurrent' | undefined,
            metadata: metadata || {}
        };

        // Store the task
        this._tasks.set(taskId, task);

        // Add to project
        project.tasks.push(taskId);
        project.updated_at = now;
        this._projects.set(project_id, project);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id: taskId,
            task
        };
    }

    /**
     * Update an existing task
     */
    private async _updateTask(params: Record<string, any>): Promise<any> {
        const { 
            task_id, title, description, status, priority, assignee, 
            due_date, tags, dependencies, execution_mode, metadata 
        } = params;

        if (!task_id) {
            return {
                success: false,
                error: 'Task ID is required'
            };
        }

        // Get the task
        const task = this._tasks.get(task_id);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${task_id} not found`
            };
        }

        // Update task properties
        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (status !== undefined) task.status = status;
        if (priority !== undefined) task.priority = priority;
        if (assignee !== undefined) task.assignee = assignee;
        if (due_date !== undefined) task.due_date = due_date;
        if (tags !== undefined) task.tags = tags;
        if (dependencies !== undefined) task.dependencies = dependencies;
        if (execution_mode !== undefined) task.execution_mode = execution_mode;
        if (metadata !== undefined) task.metadata = { ...task.metadata, ...metadata };
        
        task.updated_at = new Date().toISOString();

        // Store the updated task
        this._tasks.set(task_id, task);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id,
            task
        };
    }

    /**
     * Get a task by ID
     */
    private async _getTask(taskId: string): Promise<any> {
        if (!taskId) {
            return {
                success: false,
                error: 'Task ID is required'
            };
        }

        const task = this._tasks.get(taskId);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${taskId} not found`
            };
        }

        // If task has subtasks, get them
        const subtasks = task.subtasks && task.subtasks.length > 0
            ? task.subtasks.map(id => this._tasks.get(id)).filter(Boolean)
            : [];

        return {
            success: true,
            task,
            subtasks
        };
    }

    /**
     * List tasks, optionally filtered by project, status, or assignee
     */
    private async _listTasks(projectId?: string, status?: string, assignee?: string): Promise<any> {
        let tasks = Array.from(this._tasks.values());

        // Filter by project
        if (projectId) {
            const project = this._projects.get(projectId);
            if (!project) {
                return {
                    success: false,
                    error: `Project with ID ${projectId} not found`
                };
            }
            tasks = tasks.filter(task => project.tasks.includes(task.id));
        }

        // Filter by status
        if (status) {
            tasks = tasks.filter(task => task.status === status);
        }

        // Filter by assignee
        if (assignee) {
            tasks = tasks.filter(task => task.assignee === assignee);
        }

        return {
            success: true,
            tasks
        };
    }

    /**
     * Update a task's status
     */
    private async _updateTaskStatus(taskId: string, status: string): Promise<any> {
        if (!taskId) {
            return {
                success: false,
                error: 'Task ID is required'
            };
        }

        if (!status) {
            return {
                success: false,
                error: 'Status is required'
            };
        }

        // Validate status
        const validStatuses = ['todo', 'in_progress', 'review', 'done', 'blocked'];
        if (!validStatuses.includes(status)) {
            return {
                success: false,
                error: `Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`
            };
        }

        // Get the task
        const task = this._tasks.get(taskId);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${taskId} not found`
            };
        }

        // Update status
        task.status = status as 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
        task.updated_at = new Date().toISOString();

        // Store the updated task
        this._tasks.set(taskId, task);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id: taskId,
            status,
            task
        };
    }

    /**
     * Assign a task to an agent
     */
    private async _assignTask(taskId: string, assigneeId: string): Promise<any> {
        if (!taskId) {
            return {
                success: false,
                error: 'Task ID is required'
            };
        }

        // Get the task
        const task = this._tasks.get(taskId);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${taskId} not found`
            };
        }

        // Update assignee
        task.assignee = assigneeId || undefined;
        task.updated_at = new Date().toISOString();

        // Store the updated task
        this._tasks.set(taskId, task);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id: taskId,
            assignee: assigneeId,
            task
        };
    }

    /**
     * Create a subtask under a parent task
     */
    private async _createSubtask(params: Record<string, any>): Promise<any> {
        const { 
            parent_task_id, title, description, status = 'todo', 
            priority = 'medium', assignee, due_date, tags, metadata 
        } = params;

        if (!parent_task_id) {
            return {
                success: false,
                error: 'Parent task ID is required'
            };
        }

        if (!title) {
            return {
                success: false,
                error: 'Subtask title is required'
            };
        }

        // Validate parent task exists
        const parentTask = this._tasks.get(parent_task_id);
        if (!parentTask) {
            return {
                success: false,
                error: `Parent task with ID ${parent_task_id} not found`
            };
        }

        // Create subtask
        const now = new Date().toISOString();
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const task: Task = {
            id: taskId,
            title,
            description: description || '',
            status: (status as 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'),
            priority: (priority as 'low' | 'medium' | 'high' | 'critical'),
            assignee: assignee || undefined,
            created_by: this._currentAgent,
            created_at: now,
            updated_at: now,
            due_date: due_date,
            parent_task_id: parent_task_id,
            tags: tags || [],
            metadata: metadata || {}
        };

        // Store the subtask
        this._tasks.set(taskId, task);

        // Update parent task
        parentTask.subtasks = parentTask.subtasks || [];
        parentTask.subtasks.push(taskId);
        parentTask.updated_at = now;
        this._tasks.set(parent_task_id, parentTask);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id: taskId,
            parent_task_id,
            task
        };
    }

    /**
     * Set dependencies for a task
     */
    private async _setTaskDependencies(taskId: string, dependencies: string[]): Promise<any> {
        if (!taskId) {
            return {
                success: false,
                error: 'Task ID is required'
            };
        }

        if (!dependencies || !Array.isArray(dependencies)) {
            return {
                success: false,
                error: 'Dependencies must be an array of task IDs'
            };
        }

        // Get the task
        const task = this._tasks.get(taskId);
        if (!task) {
            return {
                success: false,
                error: `Task with ID ${taskId} not found`
            };
        }

        // Validate all dependencies exist
        const invalidDependencies = dependencies.filter(id => !this._tasks.has(id));
        if (invalidDependencies.length > 0) {
            return {
                success: false,
                error: `The following dependencies do not exist: ${invalidDependencies.join(', ')}`
            };
        }

        // Check for circular dependencies
        if (dependencies.includes(taskId)) {
            return {
                success: false,
                error: 'A task cannot depend on itself'
            };
        }

        // Update dependencies
        task.dependencies = dependencies;
        task.updated_at = new Date().toISOString();

        // Store the updated task
        this._tasks.set(taskId, task);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            task_id: taskId,
            dependencies,
            task
        };
    }

    /**
     * Create a new project
     */
    private async _createProject(params: Record<string, any>): Promise<any> {
        const { name, description, status = 'planning', metadata } = params;

        if (!name) {
            return {
                success: false,
                error: 'Project name is required'
            };
        }

        // Create project
        const now = new Date().toISOString();
        const projectId = `project-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const project: Project = {
            id: projectId,
            name,
            description: description || '',
            status: (status as 'planning' | 'active' | 'on_hold' | 'completed'),
            created_at: now,
            updated_at: now,
            tasks: [],
            teams: [],
            metadata: metadata || {}
        };

        // Store the project
        this._projects.set(projectId, project);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            project_id: projectId,
            project
        };
    }

    /**
     * Update an existing project
     */
    private async _updateProject(params: Record<string, any>): Promise<any> {
        const { project_id, name, description, status, metadata } = params;

        if (!project_id) {
            return {
                success: false,
                error: 'Project ID is required'
            };
        }

        // Get the project
        const project = this._projects.get(project_id);
        if (!project) {
            return {
                success: false,
                error: `Project with ID ${project_id} not found`
            };
        }

        // Update project properties
        if (name !== undefined) project.name = name;
        if (description !== undefined) project.description = description;
        if (status !== undefined) project.status = status;
        if (metadata !== undefined) project.metadata = { ...project.metadata, ...metadata };
        
        project.updated_at = new Date().toISOString();

        // Store the updated project
        this._projects.set(project_id, project);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            project_id,
            project
        };
    }

    /**
     * Get a project by ID
     */
    private async _getProject(projectId: string): Promise<any> {
        if (!projectId) {
            return {
                success: false,
                error: 'Project ID is required'
            };
        }

        const project = this._projects.get(projectId);
        if (!project) {
            return {
                success: false,
                error: `Project with ID ${projectId} not found`
            };
        }

        // Get all tasks for this project
        const tasks = project.tasks.map(id => this._tasks.get(id)).filter(Boolean);

        // Get all teams for this project
        const teams = project.teams.map(id => this._teams.get(id)).filter(Boolean);

        return {
            success: true,
            project,
            tasks,
            teams
        };
    }

    /**
     * List all projects, optionally filtered by status
     */
    private async _listProjects(status?: string): Promise<any> {
        let projects = Array.from(this._projects.values());

        // Filter by status
        if (status) {
            projects = projects.filter(project => project.status === status);
        }

        return {
            success: true,
            projects
        };
    }

    /**
     * Create a new team
     */
    private async _createTeam(params: Record<string, any>): Promise<any> {
        const { name, description, members = [], lead_id, metadata } = params;

        if (!name) {
            return {
                success: false,
                error: 'Team name is required'
            };
        }

        // Create team
        const now = new Date().toISOString();
        const teamId = `team-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const team: Team = {
            id: teamId,
            name,
            description: description || '',
            members: members || [],
            created_at: now,
            updated_at: now,
            lead_id,
            metadata: metadata || {}
        };

        // Store the team
        this._teams.set(teamId, team);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            team_id: teamId,
            team
        };
    }

    /**
     * Update an existing team
     */
    private async _updateTeam(params: Record<string, any>): Promise<any> {
        const { team_id, name, description, lead_id, metadata } = params;

        if (!team_id) {
            return {
                success: false,
                error: 'Team ID is required'
            };
        }

        // Get the team
        const team = this._teams.get(team_id);
        if (!team) {
            return {
                success: false,
                error: `Team with ID ${team_id} not found`
            };
        }

        // Update team properties
        if (name !== undefined) team.name = name;
        if (description !== undefined) team.description = description;
        if (lead_id !== undefined) team.lead_id = lead_id;
        if (metadata !== undefined) team.metadata = { ...team.metadata, ...metadata };
        
        team.updated_at = new Date().toISOString();

        // Store the updated team
        this._teams.set(team_id, team);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            team_id,
            team
        };
    }

    /**
     * Get a team by ID
     */
    private async _getTeam(teamId: string): Promise<any> {
        if (!teamId) {
            return {
                success: false,
                error: 'Team ID is required'
            };
        }

        const team = this._teams.get(teamId);
        if (!team) {
            return {
                success: false,
                error: `Team with ID ${teamId} not found`
            };
        }

        return {
            success: true,
            team
        };
    }

    /**
     * List all teams
     */
    private async _listTeams(): Promise<any> {
        const teams = Array.from(this._teams.values());

        return {
            success: true,
            teams
        };
    }

    /**
     * Add a member to a team
     */
    private async _addTeamMember(teamId: string, memberId: string): Promise<any> {
        if (!teamId) {
            return {
                success: false,
                error: 'Team ID is required'
            };
        }

        if (!memberId) {
            return {
                success: false,
                error: 'Member ID is required'
            };
        }

        // Get the team
        const team = this._teams.get(teamId);
        if (!team) {
            return {
                success: false,
                error: `Team with ID ${teamId} not found`
            };
        }

        // Check if member is already in team
        if (team.members.includes(memberId)) {
            return {
                success: true,
                message: `Member ${memberId} is already in team ${teamId}`,
                team_id: teamId,
                member_id: memberId,
                team
            };
        }

        // Add member to team
        team.members.push(memberId);
        team.updated_at = new Date().toISOString();

        // Store the updated team
        this._teams.set(teamId, team);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            team_id: teamId,
            member_id: memberId,
            team
        };
    }

    /**
     * Remove a member from a team
     */
    private async _removeTeamMember(teamId: string, memberId: string): Promise<any> {
        if (!teamId) {
            return {
                success: false,
                error: 'Team ID is required'
            };
        }

        if (!memberId) {
            return {
                success: false,
                error: 'Member ID is required'
            };
        }

        // Get the team
        const team = this._teams.get(teamId);
        if (!team) {
            return {
                success: false,
                error: `Team with ID ${teamId} not found`
            };
        }

        // Check if member is in team
        if (!team.members.includes(memberId)) {
            return {
                success: true,
                message: `Member ${memberId} is not in team ${teamId}`,
                team_id: teamId,
                member_id: memberId,
                team
            };
        }

        // Handle if member is the team lead
        if (team.lead_id === memberId) {
            return {
                success: false,
                error: `Cannot remove member ${memberId} because they are the team lead. Assign a new team lead first.`
            };
        }

        // Remove member from team
        team.members = team.members.filter(id => id !== memberId);
        team.updated_at = new Date().toISOString();

        // Store the updated team
        this._teams.set(teamId, team);

        // Persist changes
        await this._saveState();

        return {
            success: true,
            team_id: teamId,
            member_id: memberId,
            team
        };
    }

    /**
     * Load state from disk
     */
    private async _loadState(): Promise<void> {
        try {
            if (!this._storageRoot) {
                return;
            }
            
            const projectDir = path.join(this._storageRoot, '.tribe', 'project_management');
            
            if (!await fs.pathExists(projectDir)) {
                // No project management data yet
                return;
            }
            
            // Load projects
            const projectsFile = path.join(projectDir, 'projects.json');
            if (await fs.pathExists(projectsFile)) {
                const projectsData = await fs.readJson(projectsFile);
                // Convert array to map
                if (Array.isArray(projectsData)) {
                    projectsData.forEach(project => {
                        this._projects.set(project.id, project);
                    });
                } else {
                    Object.values(projectsData).forEach(project => {
                        this._projects.set((project as Project).id, project as Project);
                    });
                }
            }
            
            // Load tasks
            const tasksFile = path.join(projectDir, 'tasks.json');
            if (await fs.pathExists(tasksFile)) {
                const tasksData = await fs.readJson(tasksFile);
                // Convert array to map
                if (Array.isArray(tasksData)) {
                    tasksData.forEach(task => {
                        this._tasks.set(task.id, task);
                    });
                } else {
                    Object.values(tasksData).forEach(task => {
                        this._tasks.set((task as Task).id, task as Task);
                    });
                }
            }
            
            // Load teams
            const teamsFile = path.join(projectDir, 'teams.json');
            if (await fs.pathExists(teamsFile)) {
                const teamsData = await fs.readJson(teamsFile);
                // Convert array to map
                if (Array.isArray(teamsData)) {
                    teamsData.forEach(team => {
                        this._teams.set(team.id, team);
                    });
                } else {
                    Object.values(teamsData).forEach(team => {
                        this._teams.set((team as Team).id, team as Team);
                    });
                }
            }
            
            traceInfo('Loaded project management state');
        } catch (error) {
            traceError('Failed to load project management state:', error);
        }
    }

    /**
     * Save state to disk
     */
    private async _saveState(): Promise<void> {
        try {
            if (!this._storageRoot) {
                return;
            }
            
            const projectDir = path.join(this._storageRoot, '.tribe', 'project_management');
            await fs.ensureDir(projectDir);
            
            // Save projects
            const projectsFile = path.join(projectDir, 'projects.json');
            await fs.writeJson(projectsFile, Array.from(this._projects.values()), { spaces: 2 });
            
            // Save tasks
            const tasksFile = path.join(projectDir, 'tasks.json');
            await fs.writeJson(tasksFile, Array.from(this._tasks.values()), { spaces: 2 });
            
            // Save teams
            const teamsFile = path.join(projectDir, 'teams.json');
            await fs.writeJson(teamsFile, Array.from(this._teams.values()), { spaces: 2 });
            
            traceInfo('Saved project management state');
        } catch (error) {
            traceError('Failed to save project management state:', error);
        }
    }
}

/**
 * Learning Tool for working with the learning system
 */
export class LearningTool implements Tool {
    name = 'learning';
    description = 'Tool for working with the MightyDev learning system';
    usage = 'Use this tool to capture experiences, extract patterns, and manage agent learning';
    examples = [
        'Capture experience: { "action": "capture_experience", "agent_id": "agent-123", "context": "File validation", "decision": "Added strict type checking", "outcome": "Reduced bugs by 30%" }',
        'Extract patterns: { "action": "extract_patterns", "agent_id": "agent-123", "topic": "Error handling" }',
        'Generate learning summary: { "action": "generate_summary", "agent_id": "agent-123" }',
        'Create reflection: { "action": "create_reflection", "agent_id": "agent-123", "focus": "Code quality", "insights": ["Consistent naming improves readability"], "action_plan": ["Create style guide"] }',
        'Collect feedback: { "action": "collect_feedback", "source_id": "agent-123", "target_id": "agent-456", "content": "Your SQL queries could be optimized", "feedback_type": "improvement" }',
        'Get experiences: { "action": "get_experiences", "agent_id": "agent-123" }',
        'Get reflections: { "action": "get_reflections", "agent_id": "agent-123" }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (capture_experience, extract_patterns, generate_summary, create_reflection, collect_feedback, get_experiences, get_insights, get_feedback, get_reflections, get_learning_context)',
            required: true
        },
        {
            name: 'agent_id',
            type: 'string',
            description: 'The ID of the agent',
            required: false
        },
        {
            name: 'context',
            type: 'string',
            description: 'Context of the experience (for capture_experience)',
            required: false
        },
        {
            name: 'decision',
            type: 'string',
            description: 'Decision made in the experience (for capture_experience)',
            required: false
        },
        {
            name: 'outcome',
            type: 'string',
            description: 'Outcome of the experience (for capture_experience)',
            required: false
        },
        {
            name: 'topic',
            type: 'string',
            description: 'Topic for pattern extraction (for extract_patterns)',
            required: false
        },
        {
            name: 'focus',
            type: 'string',
            description: 'Focus of the reflection (for create_reflection)',
            required: false
        },
        {
            name: 'insights',
            type: 'array',
            description: 'Insights for the reflection (for create_reflection)',
            required: false
        },
        {
            name: 'action_plan',
            type: 'array',
            description: 'Action plan for the reflection (for create_reflection)',
            required: false
        },
        {
            name: 'source_id',
            type: 'string',
            description: 'ID of the feedback source agent (for collect_feedback)',
            required: false
        },
        {
            name: 'target_id',
            type: 'string',
            description: 'ID of the feedback target agent (for collect_feedback)',
            required: false
        },
        {
            name: 'content',
            type: 'string',
            description: 'Content of the feedback (for collect_feedback)',
            required: false
        },
        {
            name: 'feedback_type',
            type: 'string',
            description: 'Type of feedback (improvement, praise, correction) (for collect_feedback)',
            required: false
        },
        {
            name: 'metadata',
            type: 'object',
            description: 'Additional metadata for the experience',
            required: false
        }
    ];

    constructor(
        private readonly _projectPath: string | undefined,
        private readonly _learningSystem: any,
        private readonly _crewAIExtension: any
    ) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action } = params;

        try {
            switch (action) {
                case 'capture_experience':
                    return await this._captureExperience(params);
                case 'extract_patterns':
                    return await this._extractPatterns(params.agent_id, params.topic);
                case 'generate_summary':
                    return await this._generateSummary(params.agent_id);
                case 'create_reflection':
                    return await this._createReflection(params);
                case 'collect_feedback':
                    return await this._collectFeedback(params);
                case 'get_experiences':
                    return await this._getExperiences(params.agent_id);
                case 'get_insights':
                    return await this._getInsights(params.agent_id);
                case 'get_feedback':
                    return await this._getFeedback(params.agent_id);
                case 'get_reflections':
                    return await this._getReflections(params.agent_id);
                case 'get_learning_context':
                    return await this._getLearningContext(params.agent_id);
                case 'create_reflection_with_crewai':
                    return await this._createReflectionWithCrewAI(params.agent_id, params.topic);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`LearningTool error:`, error);
            throw error;
        }
    }

    /**
     * Capture an experience for an agent
     */
    private async _captureExperience(params: Record<string, any>): Promise<any> {
        const { agent_id, context, decision, outcome, metadata } = params;

        if (!agent_id) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        if (!context) {
            return {
                success: false,
                error: 'Experience context is required'
            };
        }

        if (!decision) {
            return {
                success: false,
                error: 'Experience decision is required'
            };
        }

        if (!outcome) {
            return {
                success: false,
                error: 'Experience outcome is required'
            };
        }

        const experience = {
            agent_id,
            context,
            decision,
            outcome,
            timestamp: new Date().toISOString(),
            metadata: metadata || {}
        };

        const result = await this._learningSystem.captureExperience(experience);

        return {
            success: result,
            experience,
            message: result ? 'Experience captured successfully' : 'Failed to capture experience'
        };
    }

    /**
     * Extract patterns from experiences
     */
    private async _extractPatterns(agentId: string, topic: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        if (!topic) {
            return {
                success: false,
                error: 'Topic is required'
            };
        }

        const insight = await this._learningSystem.extractPatterns(agentId, topic);

        if (!insight) {
            return {
                success: false,
                error: 'Failed to extract patterns or no experiences found'
            };
        }

        return {
            success: true,
            insight,
            message: 'Patterns extracted successfully'
        };
    }

    /**
     * Generate a learning summary for an agent
     */
    private async _generateSummary(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const summary = await this._learningSystem.generateLearningSummary(agentId);

        return {
            success: true,
            agent_id: agentId,
            summary,
            message: 'Learning summary generated successfully'
        };
    }

    /**
     * Create a reflection for an agent
     */
    private async _createReflection(params: Record<string, any>): Promise<any> {
        const { agent_id, focus, insights, action_plan } = params;

        if (!agent_id) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        if (!focus) {
            return {
                success: false,
                error: 'Reflection focus is required'
            };
        }

        if (!insights || !Array.isArray(insights) || insights.length === 0) {
            return {
                success: false,
                error: 'At least one insight is required'
            };
        }

        if (!action_plan || !Array.isArray(action_plan) || action_plan.length === 0) {
            return {
                success: false,
                error: 'At least one action plan step is required'
            };
        }

        const reflection = {
            id: `reflection-${Date.now()}`,
            agent_id,
            focus,
            insights,
            action_plan,
            created_at: new Date().toISOString()
        };

        const result = await this._learningSystem.createReflection(reflection);

        return {
            success: result,
            reflection,
            message: result ? 'Reflection created successfully' : 'Failed to create reflection'
        };
    }

    /**
     * Collect feedback from one agent to another
     */
    private async _collectFeedback(params: Record<string, any>): Promise<any> {
        const { source_id, target_id, content, feedback_type } = params;

        if (!source_id) {
            return {
                success: false,
                error: 'Source agent ID is required'
            };
        }

        if (!target_id) {
            return {
                success: false,
                error: 'Target agent ID is required'
            };
        }

        if (!content) {
            return {
                success: false,
                error: 'Feedback content is required'
            };
        }

        if (!feedback_type || !['improvement', 'praise', 'correction'].includes(feedback_type)) {
            return {
                success: false,
                error: 'Valid feedback type is required (improvement, praise, or correction)'
            };
        }

        const feedback = {
            id: `feedback-${Date.now()}`,
            source_id,
            target_id,
            content,
            feedback_type: feedback_type as 'improvement' | 'praise' | 'correction',
            created_at: new Date().toISOString()
        };

        const result = await this._learningSystem.collectFeedback(feedback);

        return {
            success: result,
            feedback,
            message: result ? 'Feedback collected successfully' : 'Failed to collect feedback'
        };
    }

    /**
     * Get all experiences for an agent
     */
    private async _getExperiences(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const experiences = this._learningSystem.getExperiences(agentId);

        return {
            success: true,
            agent_id: agentId,
            experiences,
            count: experiences.length
        };
    }

    /**
     * Get all insights for an agent
     */
    private async _getInsights(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const insights = this._learningSystem.getInsights(agentId);

        return {
            success: true,
            agent_id: agentId,
            insights,
            count: insights.length
        };
    }

    /**
     * Get all feedback for an agent
     */
    private async _getFeedback(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const feedback = this._learningSystem.getFeedback(agentId);

        return {
            success: true,
            agent_id: agentId,
            feedback,
            count: feedback.length
        };
    }

    /**
     * Get all reflections for an agent
     */
    private async _getReflections(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const reflections = this._learningSystem.getReflections(agentId);

        return {
            success: true,
            agent_id: agentId,
            reflections,
            count: reflections.length
        };
    }

    /**
     * Get learning context for an agent
     * This provides a comprehensive learning summary for use in agent prompts
     */
    private async _getLearningContext(agentId: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        const context = await this._learningSystem.getAgentLearningContext(agentId);

        return {
            success: true,
            agent_id: agentId,
            context,
            message: 'Learning context retrieved successfully'
        };
    }

    /**
     * Create a reflection with CrewAI
     * This uses the CrewAI integration to analyze experiences and create a reflection
     */
    private async _createReflectionWithCrewAI(agentId: string, topic: string): Promise<any> {
        if (!agentId) {
            return {
                success: false,
                error: 'Agent ID is required'
            };
        }

        if (!topic) {
            return {
                success: false,
                error: 'Topic is required'
            };
        }

        if (!this._crewAIExtension) {
            return {
                success: false,
                error: 'CrewAI extension is not available'
            };
        }

        const reflection = await this._learningSystem.createReflectionWithCrewAI(
            this._crewAIExtension,
            agentId,
            topic
        );

        if (!reflection) {
            return {
                success: false,
                error: 'Failed to create reflection with CrewAI or no experiences found'
            };
        }

        return {
            success: true,
            reflection,
            message: 'Reflection created successfully with CrewAI'
        };
    }
}

/**
 * Messaging Tool for agent-to-agent and agent-to-human messaging
 */
export class MessagingTool implements Tool {
    name = 'messaging';
    description = 'Tool for agent-to-agent and agent-to-human messaging';
    usage = 'Use this tool to send messages between agents, to teams, or to humans';
    examples = [
        'Send message to agent: { "action": "send_message", "to": "agent-123", "content": "Can you help with this issue?" }',
        'Send team message: { "action": "send_team_message", "team_id": "team-456", "content": "We need to discuss our approach" }',
        'Create thread: { "action": "create_thread", "title": "Feature discussion", "participants": ["agent-123", "agent-456"] }',
        'Reply to message: { "action": "reply", "message_id": "msg-789", "content": "I agree with your approach" }',
        'Get thread messages: { "action": "get_thread", "thread_id": "thread-123" }',
        'Get conversation history: { "action": "get_conversation", "with": "agent-123", "limit": 10 }'
    ];
    parameters = [
        {
            name: 'action',
            type: 'string',
            description: 'The action to perform (send_message, send_team_message, create_thread, reply, get_thread, get_conversation)',
            required: true
        },
        {
            name: 'to',
            type: 'string',
            description: 'The recipient agent ID or comma-separated list of agent IDs',
            required: false
        },
        {
            name: 'team_id',
            type: 'string',
            description: 'The team ID to send a message to',
            required: false
        },
        {
            name: 'content',
            type: 'string',
            description: 'The message content',
            required: false
        },
        {
            name: 'title',
            type: 'string',
            description: 'The title for a new thread',
            required: false
        },
        {
            name: 'participants',
            type: 'array',
            description: 'The participants for a new thread',
            required: false
        },
        {
            name: 'message_id',
            type: 'string',
            description: 'The ID of the message to reply to',
            required: false
        },
        {
            name: 'thread_id',
            type: 'string',
            description: 'The ID of the thread to get messages from',
            required: false
        },
        {
            name: 'with',
            type: 'string',
            description: 'The agent ID to get conversation history with',
            required: false
        },
        {
            name: 'limit',
            type: 'number',
            description: 'The maximum number of messages to retrieve',
            required: false,
            default: 10
        },
        {
            name: 'attachments',
            type: 'array',
            description: 'Attachments to include with the message',
            required: false
        }
    ];

    // Message storage
    private _messages: Map<string, Message> = new Map();
    private _threads: Map<string, MessageThread> = new Map();
    private _conversationHistory: Map<string, Message[]> = new Map();
    private _teams: Map<string, string[]> = new Map(); // team_id -> agent_ids
    private _isTyping: Map<string, boolean> = new Map(); // agent_id -> isTyping

    constructor(
        private readonly _storageRoot: string,
        private readonly _currentAgent: string,
        private readonly _crewAIExtension: any
    ) {}

    /**
     * Execute the tool
     */
    async execute(params: Record<string, any>): Promise<any> {
        const { action } = params;

        try {
            switch (action) {
                case 'send_message':
                    return await this._sendMessage(params.to, params.content, params.attachments);
                case 'send_team_message':
                    return await this._sendTeamMessage(params.team_id, params.content, params.attachments);
                case 'create_thread':
                    return await this._createThread(params.title, params.participants);
                case 'reply':
                    return await this._replyToMessage(params.message_id, params.content, params.attachments);
                case 'get_thread':
                    return await this._getThread(params.thread_id, params.limit);
                case 'get_conversation':
                    return await this._getConversation(params.with, params.limit);
                case 'set_typing':
                    return await this._setTypingStatus(params.to, params.isTyping === true);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            traceError(`MessagingTool error:`, error);
            throw error;
        }
    }

    /**
     * Send a message to another agent
     */
    private async _sendMessage(to: string | string[], content: string, attachments?: Attachment[]): Promise<any> {
        if (!to) {
            return {
                success: false,
                error: 'Recipient not specified'
            };
        }

        // Safe check for content and attachments
        const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
        
        if (!content && !hasAttachments) {
            return {
                success: false,
                error: 'Message content or attachments must be provided'
            };
        }

        // Create message object
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const message: Message = {
            id: messageId,
            from: this._currentAgent,
            to: Array.isArray(to) ? to : [to],
            content: content || '',
            timestamp: new Date().toISOString(),
            attachments: attachments || []
        };

        // Store the message
        this._messages.set(messageId, message);

        // Update conversation history
        const recipients = Array.isArray(to) ? to : [to];
        recipients.forEach(recipient => {
            const conversationKey = [this._currentAgent, recipient].sort().join('-');
            const history = this._conversationHistory.get(conversationKey) || [];
            history.push(message);
            this._conversationHistory.set(conversationKey, history);
        });

        // Save the message to persistent storage
        await this._persistMessages();

        // In a real implementation, this would communicate with the CrewAI server
        // to deliver the message to the recipient agent(s)
        if (this._crewAIExtension) {
            try {
                // For each recipient, send the message
                for (const recipient of recipients) {
                    await this._crewAIExtension.sendRequest('send_message', {
                        agent_id: recipient,
                        message: content,
                        from_agent_id: this._currentAgent,
                        attachments: attachments
                    });
                }
            } catch (error) {
                traceError(`Error sending message via CrewAI:`, error);
            }
        }

        return {
            success: true,
            message_id: messageId,
            message
        };
    }

    /**
     * Send a message to a team
     */
    private async _sendTeamMessage(teamId: string, content: string, attachments?: Attachment[]): Promise<any> {
        if (!teamId) {
            return {
                success: false,
                error: 'Team ID not specified'
            };
        }

        // Safe check for content and attachments
        const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
        
        if (!content && !hasAttachments) {
            return {
                success: false,
                error: 'Message content or attachments must be provided'
            };
        }

        // Get team members
        const teamMembers = this._teams.get(teamId);
        if (!teamMembers || teamMembers.length === 0) {
            return {
                success: false,
                error: `Team with ID ${teamId} not found or has no members`
            };
        }

        // Create message object
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const message: Message = {
            id: messageId,
            from: this._currentAgent,
            to: teamMembers,
            content: content || '',
            timestamp: new Date().toISOString(),
            attachments: attachments || [],
            isTeamMessage: true,
            metadata: { teamId }
        };

        // Store the message
        this._messages.set(messageId, message);

        // Update team conversation
        const teamConversationKey = `team-${teamId}`;
        const history = this._conversationHistory.get(teamConversationKey) || [];
        history.push(message);
        this._conversationHistory.set(teamConversationKey, history);

        // Save the message to persistent storage
        await this._persistMessages();

        // In a real implementation, this would communicate with the CrewAI server
        // to deliver the message to all team members
        if (this._crewAIExtension) {
            try {
                await this._crewAIExtension.sendRequest('send_message', {
                    team_id: teamId,
                    message: content,
                    from_agent_id: this._currentAgent,
                    attachments: attachments,
                    is_team_message: true
                });
            } catch (error) {
                traceError(`Error sending team message via CrewAI:`, error);
            }
        }

        return {
            success: true,
            message_id: messageId,
            message,
            team_members: teamMembers
        };
    }

    /**
     * Create a new message thread
     */
    private async _createThread(title: string, participants: string[]): Promise<any> {
        if (!title) {
            return {
                success: false,
                error: 'Thread title not specified'
            };
        }

        if (!participants || participants.length === 0) {
            return {
                success: false,
                error: 'Thread participants not specified'
            };
        }

        // Add current agent to participants if not already included
        if (!participants.includes(this._currentAgent)) {
            participants.push(this._currentAgent);
        }

        // Create thread object
        const threadId = `thread-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = new Date().toISOString();
        const thread: MessageThread = {
            id: threadId,
            title,
            participants,
            messages: [],
            createdAt: now,
            lastActivity: now
        };

        // Store the thread
        this._threads.set(threadId, thread);

        // Save the thread to persistent storage
        await this._persistThreads();

        return {
            success: true,
            thread_id: threadId,
            thread
        };
    }

    /**
     * Reply to a message
     */
    private async _replyToMessage(messageId: string, content: string, attachments?: Attachment[]): Promise<any> {
        if (!messageId) {
            return {
                success: false,
                error: 'Message ID not specified'
            };
        }

        if (!content && (!attachments || attachments.length === 0)) {
            return {
                success: false,
                error: 'Reply content or attachments must be provided'
            };
        }

        // Get the original message
        const originalMessage = this._messages.get(messageId);
        if (!originalMessage) {
            return {
                success: false,
                error: `Message with ID ${messageId} not found`
            };
        }

        // Determine the thread ID
        let threadId = originalMessage.threadId;
        
        // If no thread exists yet, create one
        if (!threadId) {
            // Create a new thread with the original message participants
            const participants = Array.isArray(originalMessage.to) 
                ? [originalMessage.from, ...originalMessage.to] 
                : [originalMessage.from, originalMessage.to];
            
            // Deduplicate participants
            const uniqueParticipants = [...new Set(participants)];
            
            // Create thread title from original message content
            const threadTitle = originalMessage.content.length > 30
                ? `${originalMessage.content.substring(0, 30)}...`
                : originalMessage.content;
            
            const thread = await this._createThread(threadTitle, uniqueParticipants);
            threadId = thread.thread_id;
            
            // Update the original message with the thread ID
            originalMessage.threadId = threadId;
            this._messages.set(messageId, originalMessage);
            
            // Add the original message to the thread
            const threadObj = this._threads.get(threadId as string);
            if (threadObj) {
                threadObj.messages.push(originalMessage);
                this._threads.set(threadId as string, threadObj);
            }
        }

        // Create reply message
        const replyId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const reply: Message = {
            id: replyId,
            from: this._currentAgent,
            to: originalMessage.from,
            content: content || '',
            timestamp: new Date().toISOString(),
            attachments: attachments || [],
            threadId,
            parentId: messageId
        };

        // Store the reply
        this._messages.set(replyId, reply);

        // Update the thread
        const thread = this._threads.get(threadId!);
        if (thread) {
            thread.messages.push(reply);
            thread.lastActivity = reply.timestamp;
            this._threads.set(threadId!, thread);
        }

        // Update conversation history
        const conversationKey = [this._currentAgent, originalMessage.from].sort().join('-');
        const history = this._conversationHistory.get(conversationKey) || [];
        history.push(reply);
        this._conversationHistory.set(conversationKey, history);

        // Save the messages and threads to persistent storage
        await Promise.all([
            this._persistMessages(),
            this._persistThreads()
        ]);

        // In a real implementation, this would communicate with the CrewAI server
        // to deliver the reply to the recipient agent(s)
        if (this._crewAIExtension) {
            try {
                await this._crewAIExtension.sendRequest('send_message', {
                    agent_id: originalMessage.from,
                    message: content,
                    from_agent_id: this._currentAgent,
                    attachments: attachments,
                    thread_id: threadId,
                    parent_id: messageId
                });
            } catch (error) {
                traceError(`Error sending reply via CrewAI:`, error);
            }
        }

        return {
            success: true,
            message_id: replyId,
            thread_id: threadId,
            message: reply
        };
    }

    /**
     * Get messages from a thread
     */
    private async _getThread(threadId: string, limit: number = 10): Promise<any> {
        if (!threadId) {
            return {
                success: false,
                error: 'Thread ID not specified'
            };
        }

        // Get the thread
        const thread = this._threads.get(threadId);
        if (!thread) {
            return {
                success: false,
                error: `Thread with ID ${threadId} not found`
            };
        }

        // Get the messages in reverse chronological order (newest first)
        const messages = [...thread.messages]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);

        return {
            success: true,
            thread,
            messages
        };
    }

    /**
     * Get conversation history with another agent
     */
    private async _getConversation(with_agent: string, limit: number = 10): Promise<any> {
        if (!with_agent) {
            return {
                success: false,
                error: 'Conversation partner not specified'
            };
        }

        // Get the conversation history
        const conversationKey = [this._currentAgent, with_agent].sort().join('-');
        const history = this._conversationHistory.get(conversationKey) || [];

        // Get the messages in reverse chronological order (newest first)
        const messages = [...history]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);

        return {
            success: true,
            with: with_agent,
            messages
        };
    }

    /**
     * Set typing status for agent-to-agent communication
     */
    private async _setTypingStatus(to: string, isTyping: boolean): Promise<any> {
        if (!to) {
            return {
                success: false,
                error: 'Recipient not specified'
            };
        }

        // Update typing status
        this._isTyping.set(this._currentAgent, isTyping);

        // In a real implementation, this would communicate with the CrewAI server
        // to update the typing status in the UI
        if (this._crewAIExtension) {
            try {
                await this._crewAIExtension.sendRequest('update_typing_status', {
                    agent_id: this._currentAgent,
                    recipient_id: to,
                    is_typing: isTyping
                });
            } catch (error) {
                traceError(`Error updating typing status via CrewAI:`, error);
            }
        }

        return {
            success: true,
            agent_id: this._currentAgent,
            to,
            is_typing: isTyping
        };
    }

    /**
     * Get typing status for an agent
     */
    public getTypingStatus(agentId: string): boolean {
        return this._isTyping.get(agentId) || false;
    }

    /**
     * Add a team to the messaging tool
     */
    public addTeam(teamId: string, members: string[]): void {
        this._teams.set(teamId, members);
    }

    /**
     * Get team members
     */
    public getTeamMembers(teamId: string): string[] {
        return this._teams.get(teamId) || [];
    }

    /**
     * Save messages to persistent storage
     */
    private async _persistMessages(): Promise<void> {
        try {
            const messagesJson = JSON.stringify(Array.from(this._messages.entries()));
            const historyJson = JSON.stringify(Array.from(this._conversationHistory.entries()));
            
            const messagesPath = path.join(this._storageRoot, '.tribe', 'messaging', 'messages.json');
            const historyPath = path.join(this._storageRoot, '.tribe', 'messaging', 'history.json');
            
            // Ensure directory exists
            await fs.ensureDir(path.dirname(messagesPath));
            
            // Write files
            await Promise.all([
                fs.writeFile(messagesPath, messagesJson),
                fs.writeFile(historyPath, historyJson)
            ]);
        } catch (error) {
            traceError(`Error persisting messages:`, error);
        }
    }

    /**
     * Save threads to persistent storage
     */
    private async _persistThreads(): Promise<void> {
        try {
            const threadsJson = JSON.stringify(Array.from(this._threads.entries()));
            const teamsJson = JSON.stringify(Array.from(this._teams.entries()));
            
            const threadsPath = path.join(this._storageRoot, '.tribe', 'messaging', 'threads.json');
            const teamsPath = path.join(this._storageRoot, '.tribe', 'messaging', 'teams.json');
            
            // Ensure directory exists
            await fs.ensureDir(path.dirname(threadsPath));
            
            // Write files
            await Promise.all([
                fs.writeFile(threadsPath, threadsJson),
                fs.writeFile(teamsPath, teamsJson)
            ]);
        } catch (error) {
            traceError(`Error persisting threads:`, error);
        }
    }

    /**
     * Load data from persistent storage
     */
    public async loadFromStorage(): Promise<void> {
        try {
            const messagesPath = path.join(this._storageRoot, '.tribe', 'messaging', 'messages.json');
            const historyPath = path.join(this._storageRoot, '.tribe', 'messaging', 'history.json');
            const threadsPath = path.join(this._storageRoot, '.tribe', 'messaging', 'threads.json');
            const teamsPath = path.join(this._storageRoot, '.tribe', 'messaging', 'teams.json');

            // Load messages
            if (await fs.pathExists(messagesPath)) {
                const messagesJson = await fs.readFile(messagesPath, 'utf8');
                this._messages = new Map(JSON.parse(messagesJson));
            }

            // Load conversation history
            if (await fs.pathExists(historyPath)) {
                const historyJson = await fs.readFile(historyPath, 'utf8');
                this._conversationHistory = new Map(JSON.parse(historyJson));
            }

            // Load threads
            if (await fs.pathExists(threadsPath)) {
                const threadsJson = await fs.readFile(threadsPath, 'utf8');
                this._threads = new Map(JSON.parse(threadsJson));
            }

            // Load teams
            if (await fs.pathExists(teamsPath)) {
                const teamsJson = await fs.readFile(teamsPath, 'utf8');
                this._teams = new Map(JSON.parse(teamsJson));
            }
        } catch (error) {
            traceError(`Error loading messaging data from storage:`, error);
        }
    }
}