#!/usr/bin/env node

// This script installs Python dependencies in the bundled Python environment
// It checks bundled, virtual environment, and system Python locations

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Extension root directory
const EXTENSION_ROOT_DIR = __dirname;

// Dependencies to install
const dependencies = [
    'crewai[tools]',
    'pygls',
    'lsprotocol',
    'cattrs'
];

// Find Python executable in various locations
function findPythonPath() {
    const platform = process.platform;
    let pythonPaths = [];

    // Try bundled Python first
    const bundledPythonDir = path.join(EXTENSION_ROOT_DIR, 'python', platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');
    const bundledPythonPath = path.join(bundledPythonDir, platform === 'win32' ? 'python.exe' : 'bin/python3');
    
    if (fs.existsSync(bundledPythonPath)) {
        console.log(`Found bundled Python at ${bundledPythonPath}`);
        pythonPaths.push(bundledPythonPath);
    }

    // Try virtual environment
    const venvDir = path.join(EXTENSION_ROOT_DIR, '.venv');
    const venvPython = platform === 'win32' 
        ? path.join(venvDir, 'Scripts', 'python.exe') 
        : path.join(venvDir, 'bin', 'python');
    
    if (fs.existsSync(venvPython)) {
        console.log(`Found virtual environment Python at ${venvPython}`);
        pythonPaths.push(venvPython);
    }

    // Try to install to bundled/libs directory
    const bundledLibsDir = path.join(EXTENSION_ROOT_DIR, 'bundled', 'libs');
    
    // Ensure the directory exists
    if (!fs.existsSync(bundledLibsDir)) {
        try {
            fs.mkdirSync(bundledLibsDir, { recursive: true });
            console.log(`Created bundled libs directory: ${bundledLibsDir}`);
        } catch (err) {
            console.error(`Error creating bundled libs directory: ${err.message}`);
        }
    }

    // Try system Python commands
    const pythonCommands = platform === 'win32' 
        ? ['python.exe', 'python3.exe', 'py.exe'] 
        : ['python3', 'python'];
    
    for (const cmd of pythonCommands) {
        try {
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
                    console.log(`Found system Python: ${pythonPath} (${result.stdout.trim()})`);
                    pythonPaths.push(pythonPath);
                }
            }
        } catch (error) {
            // Ignore errors, just try the next command
        }
    }

    return pythonPaths;
}

// Install dependencies using pip
async function installDependencies(pythonPath) {
    return new Promise((resolve, reject) => {
        // Create the libs directory to install packages to
        const bundledLibsDir = path.join(EXTENSION_ROOT_DIR, 'bundled', 'libs');
        
        // Build pip install command
        const pipArgs = [
            '-m', 'pip', 'install',
            '--upgrade',
            '--target', bundledLibsDir,
            ...dependencies
        ];
        
        console.log(`Installing dependencies using ${pythonPath} with target directory ${bundledLibsDir}:`);
        dependencies.forEach(dep => console.log(`- ${dep}`));
        
        // Run pip install
        const pip = spawn(pythonPath, pipArgs, {
            stdio: 'inherit',
            env: { ...process.env, PYTHONPATH: bundledLibsDir }
        });
        
        pip.on('close', (code) => {
            if (code !== 0) {
                console.error(`Failed to install dependencies with exit code ${code}`);
                reject(new Error(`Pip install failed with exit code ${code}`));
            } else {
                console.log('Dependencies installed successfully');
                
                // Create a .pth file to add the libs directory to Python's import path
                const sitePackagesDir = path.join(EXTENSION_ROOT_DIR, 'bundled');
                const pthFile = path.join(sitePackagesDir, 'bundled_libs.pth');
                
                try {
                    fs.writeFileSync(pthFile, bundledLibsDir);
                    console.log(`Created .pth file at ${pthFile}`);
                } catch (err) {
                    console.error(`Error creating .pth file: ${err.message}`);
                }
                
                resolve();
            }
        });
    });
}

// Main function
async function main() {
    try {
        console.log('MightyDev Python Dependencies Installer');
        console.log('======================================');
        
        const pythonPaths = findPythonPath();
        
        if (pythonPaths.length === 0) {
            console.error('No Python interpreter found. Please install Python 3.8 or newer.');
            process.exit(1);
        }
        
        // Try each Python path until one succeeds
        let success = false;
        for (const pythonPath of pythonPaths) {
            try {
                await installDependencies(pythonPath);
                success = true;
                break;
            } catch (error) {
                console.error(`Failed to install with ${pythonPath}: ${error.message}`);
            }
        }
        
        if (!success) {
            console.error('Failed to install dependencies with any available Python interpreter.');
            process.exit(1);
        }
        
        console.log('\nSetup complete! The extension should now be able to use CrewAI.');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the main function
main();