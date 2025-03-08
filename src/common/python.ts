// Copyright (c) Microsoft Corporation. All rights reserved.
// Modified by MightyDev team
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/naming-convention */
import { commands, Disposable, Event, EventEmitter, Uri } from 'vscode';
import { traceError, traceLog, traceInfo } from './log/logging';
import { PythonExtension, ResolvedEnvironment } from '@vscode/python-extension';
import * as path from 'path';
import * as fs from 'fs-extra';
import { EXTENSION_ROOT_DIR } from './constants';

export interface IInterpreterDetails {
    path?: string[];
    resource?: Uri;
}

const onDidChangePythonInterpreterEvent = new EventEmitter<IInterpreterDetails>();
export const onDidChangePythonInterpreter: Event<IInterpreterDetails> = onDidChangePythonInterpreterEvent.event;

let _api: PythonExtension | undefined;
async function getPythonExtensionAPI(): Promise<PythonExtension | undefined> {
    if (_api) {
        return _api;
    }
    
    try {
        _api = await PythonExtension.api();
        return _api;
    } catch (error) {
        // Python extension might not be installed
        traceInfo('Could not get Python extension API. The extension might not be installed.');
        return undefined;
    }
}

export async function initializePython(disposables: Disposable[]): Promise<void> {
    try {
        // First check if we have bundled Python
        const bundledPythonPath = getBundledPythonPath();
        if (bundledPythonPath.length > 0) {
            traceInfo(`Using bundled Python: ${bundledPythonPath.join(' ')}`);
            onDidChangePythonInterpreterEvent.fire({ path: bundledPythonPath });
            return;
        }
        
        // Try to get Python from the Python extension
        const api = await getPythonExtensionAPI();

        if (api) {
            // Register for Python environment changes
            disposables.push(
                api.environments.onDidChangeActiveEnvironmentPath((e) => {
                    onDidChangePythonInterpreterEvent.fire({ path: [e.path], resource: e.resource?.uri });
                }),
            );

            traceLog('Getting interpreter details');
            const interpreterDetails = await getInterpreterDetails();
            
            if (interpreterDetails.path && interpreterDetails.path.length > 0) {
                traceInfo(`Using Python: ${interpreterDetails.path.join(' ')}`);
                onDidChangePythonInterpreterEvent.fire(interpreterDetails);
            } else {
                traceError('No Python interpreter found. Some features may not work correctly.');
            }
        } else {
            // Python extension not available, try to find a system Python
            const systemPythonPaths = findSystemPython();
            if (systemPythonPaths.length > 0) {
                traceInfo(`Using system Python: ${systemPythonPaths[0]}`);
                onDidChangePythonInterpreterEvent.fire({ path: systemPythonPaths });
            } else {
                traceError('No Python interpreter found. MightyDev requires Python 3.8 or newer.');
            }
        }
    } catch (error) {
        traceError('Error initializing python: ', error);
    }
}

export async function resolveInterpreter(interpreter: string[]): Promise<ResolvedEnvironment | undefined> {
    const api = await getPythonExtensionAPI();
    return api?.environments.resolveEnvironment(interpreter[0]);
}

/**
 * Check if we have a bundled Python for this platform
 */
export function getBundledPythonPath(): string[] {
    const platform = process.platform;
    let platformDir: string;
    let pythonExePath: string;
    let fallbackPaths: string[] = [];

    if (platform === 'win32') {
        platformDir = 'win32';
        pythonExePath = 'python.exe';
    } else if (platform === 'darwin') {
        platformDir = 'darwin';
        pythonExePath = 'bin/python3';
        // Add macOS-specific fallback paths
        fallbackPaths = [
            '/usr/bin/python3',
            '/usr/local/bin/python3'
        ];
    } else {
        platformDir = 'linux';
        pythonExePath = 'bin/python3';
        // Add Linux-specific fallback paths
        fallbackPaths = [
            '/usr/bin/python3',
            '/usr/local/bin/python3'
        ];
    }

    // Check for bundled Python first (highest priority)
    const bundledPythonDir = path.join(EXTENSION_ROOT_DIR, 'python', platformDir);
    const bundledPythonPath = path.join(bundledPythonDir, pythonExePath);

    if (fs.existsSync(bundledPythonPath)) {
        traceInfo(`Found bundled Python at ${bundledPythonPath}`);
        return [bundledPythonPath];
    }

    // Check for launcher script that may have been created
    const launcherPath = path.join(bundledPythonDir, 'python_launcher.js');
    if (fs.existsSync(launcherPath)) {
        traceInfo(`Found Python launcher script at ${launcherPath}`);
        
        // The launcher script is a Node.js script that launches Python
        // We can run it with node and pass arguments to Python
        // For example: node python_launcher.js -m pip install -r requirements.txt
        
        // Check if we have node in PATH
        try {
            const nodePath = process.execPath; // Current Node.js executable
            if (nodePath) {
                traceInfo(`Using Node.js launcher at ${nodePath} with script ${launcherPath}`);
                return [nodePath, launcherPath];
            }
        } catch (error) {
            traceError('Error getting Node.js path for launcher:', error);
        }
    }

    // Check for virtual environment (second priority)
    const venvDir = path.join(EXTENSION_ROOT_DIR, '.venv');
    const venvPython = platform === 'win32' 
        ? path.join(venvDir, 'Scripts', 'python.exe') 
        : path.join(venvDir, 'bin', 'python');
    
    if (fs.existsSync(venvPython)) {
        traceInfo(`Found virtual environment Python at ${venvPython}`);
        return [venvPython];
    }

    // Check for Python in PATH (third priority)
    // We'll let the Python extension handle this, but log it
    traceInfo('No bundled or virtual environment Python found, will fall back to Python extension');
    
    return [];
}

export async function getInterpreterDetails(resource?: Uri): Promise<IInterpreterDetails> {
    // First try to get the bundled Python
    const bundledPythonPath = getBundledPythonPath();
    if (bundledPythonPath.length > 0) {
        traceInfo(`Using bundled Python: ${bundledPythonPath[0]}`);
        return { path: bundledPythonPath, resource };
    }
    
    // If not found, try to find a system Python
    const systemPythonPaths = findSystemPython();
    if (systemPythonPaths.length > 0) {
        traceInfo(`Using system Python: ${systemPythonPaths[0]}`);
        return { path: systemPythonPaths, resource };
    }
    
    // If still not found, fall back to Python extension (if available)
    const api = await getPythonExtensionAPI();
    if (api) {
        try {
            const environment = await api.environments.resolveEnvironment(
                api.environments.getActiveEnvironmentPath(resource),
            );
            if (environment?.executable.uri && checkVersion(environment)) {
                traceInfo(`Using Python from Python extension: ${environment.executable.uri.fsPath}`);
                return { path: [environment.executable.uri.fsPath], resource };
            }
        } catch (error) {
            traceError('Error getting Python environment from Python extension:', error);
        }
    }
    
    traceError('No Python interpreter found. MightyDev requires Python 3.8 or newer.');
    return { path: undefined, resource };
}

/**
 * Attempts to find a system-installed Python
 */
function findSystemPython(): string[] {
    const platform = process.platform;
    let pythonCommands: string[] = [];
    
    if (platform === 'win32') {
        pythonCommands = ['python.exe', 'python3.exe', 'py.exe'];
    } else {
        pythonCommands = ['python3', 'python'];
    }
    
    // Try to find Python in the PATH
    for (const cmd of pythonCommands) {
        try {
            const { spawnSync } = require('child_process');
            const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
            
            if (result.status === 0) {
                // Get the full path to the Python executable
                const pathResult = spawnSync(
                    platform === 'win32' ? 'where' : 'which',
                    [cmd],
                    { encoding: 'utf8' }
                );
                
                if (pathResult.status === 0) {
                    const pythonPath = pathResult.stdout.trim().split('\n')[0];
                    traceInfo(`Found system Python: ${pythonPath} (${result.stdout.trim()})`);
                    return [pythonPath];
                }
            }
        } catch (error) {
            // Ignore errors, just try the next command
        }
    }
    
    return [];
}

export async function getDebuggerPath(): Promise<string | undefined> {
    const api = await getPythonExtensionAPI();
    return api?.debug.getDebuggerPackagePath();
}

export async function runPythonExtensionCommand(command: string, ...rest: any[]) {
    await getPythonExtensionAPI();
    return await commands.executeCommand(command, ...rest);
}

export function checkVersion(resolved: ResolvedEnvironment | undefined): boolean {
    const version = resolved?.version;
    if (version?.major === 3 && version?.minor >= 8) {
        return true;
    }
    traceError(`Python version ${version?.major}.${version?.minor} is not supported.`);
    traceError(`Selected python path: ${resolved?.executable.uri?.fsPath}`);
    traceError('Supported versions are 3.8 and above.');
    return false;
}
