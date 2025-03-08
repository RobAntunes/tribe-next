#!/usr/bin/env node
/**
 * Simple test for bundled Python
 */

const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

// Get the extension root directory
const EXTENSION_ROOT_DIR = path.resolve(__dirname, '..');

// Get platform information
const platform = process.platform;
let platformDir;
let pythonExePath;

if (platform === 'win32') {
    platformDir = 'win32';
    pythonExePath = 'python.exe';
} else if (platform === 'darwin') {
    platformDir = 'darwin';
    pythonExePath = 'bin/python3';
} else {
    platformDir = 'linux';
    pythonExePath = 'bin/python3';
}

// Check for bundled Python
const bundledPythonDir = path.join(EXTENSION_ROOT_DIR, 'python', platformDir);
const bundledPythonPath = path.join(bundledPythonDir, pythonExePath);

console.log('Testing bundled Python...');
console.log(`Checking for Python at: ${bundledPythonPath}`);

if (fs.existsSync(bundledPythonPath)) {
    console.log(`✅ Found bundled Python at ${bundledPythonPath}`);
    
    // Try to execute the Python version
    const result = spawnSync(bundledPythonPath, ['--version']);
    const versionOutput = result.stdout.toString().trim() || result.stderr.toString().trim();
    
    console.log(`✅ Python version: ${versionOutput}`);
    
    // Test importing a module
    const testImport = spawnSync(bundledPythonPath, ['-c', 'import sys; print(sys.version_info)']);
    console.log(`✅ Python sys.version_info: ${testImport.stdout.toString().trim()}`);
    
    console.log('Python bundling test passed!');
} else {
    console.log(`❌ No bundled Python found at ${bundledPythonPath}`);
    
    // Check for virtual environment
    const venvDir = path.join(EXTENSION_ROOT_DIR, '.venv');
    const venvPython = platform === 'win32' 
        ? path.join(venvDir, 'Scripts', 'python.exe') 
        : path.join(venvDir, 'bin', 'python');
    
    if (fs.existsSync(venvPython)) {
        console.log(`✅ Found virtual environment Python at ${venvPython}`);
        
        // Try to execute the Python version
        const result = spawnSync(venvPython, ['--version']);
        const versionOutput = result.stdout.toString().trim() || result.stderr.toString().trim();
        
        console.log(`✅ Virtual env Python version: ${versionOutput}`);
    } else {
        console.log(`❌ No virtual environment Python found at ${venvPython}`);
    }
}