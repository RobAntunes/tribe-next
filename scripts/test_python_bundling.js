#!/usr/bin/env node
/**
 * Test script for Python bundling
 * 
 * This script checks if the bundled Python is correctly detected by the extension code.
 */

const fs = require('fs');
const path = require('path');

// Mock vscode.Uri for testing
class MockUri {
    constructor(fsPath) {
        this.fsPath = fsPath;
    }
}

// Setup mock console
global.console = {
    ...console,
    log: console.log,
    error: console.error,
    info: console.log,
};

// Create a simple mock for tracing functions
const traceLog = (...args) => console.log('[LOG]', ...args);
const traceInfo = (...args) => console.log('[INFO]', ...args);
const traceError = (...args) => console.error('[ERROR]', ...args);

// Mock the constants module
const EXTENSION_ROOT_DIR = path.resolve(__dirname, '..');

// Run the test
async function testPythonBundling() {
    console.log('Testing Python bundling...');
    console.log(`Extension root: ${EXTENSION_ROOT_DIR}`);
    
    // Import the getBundledPythonPath function from python.ts
    // Since it's TypeScript, we need to require the transpiled JavaScript
    // For testing purposes, we'll create a temporary JavaScript version
    
    const pythonTsPath = path.join(EXTENSION_ROOT_DIR, 'src', 'common', 'python.ts');
    const tempJsPath = path.join(__dirname, 'python_test.js');
    
    // Read the TypeScript file
    const tsCode = fs.readFileSync(pythonTsPath, 'utf8');
    
    // Extract only the getBundledPythonPath function
    const functionMatch = tsCode.match(/export function getBundledPythonPath\(\)[^}]+\n}$/m);
    
    if (!functionMatch) {
        console.error('Could not find getBundledPythonPath function in python.ts');
        return;
    }
    
    // Get the function code
    let functionCode = functionMatch[0];
    
    // Clean up the function code
    functionCode = functionCode
        .replace(/export function/, 'function')
        .replace(/: string\[\]/g, '')
        .replace(/: string;/g, ';')
        .replace(/traceLog/g, 'console.log')
        .replace(/traceInfo/g, 'console.info')
        .replace(/traceError/g, 'console.error');
    
    // Add mock implementations and constants
    const jsCode = `
const path = require('path');
const fs = require('fs-extra');
const EXTENSION_ROOT_DIR = "${EXTENSION_ROOT_DIR.replace(/\\/g, '\\\\')}";

${functionCode}

// Run the test
const pythonPath = getBundledPythonPath();
console.log('Bundled Python path:', pythonPath);

if (pythonPath && pythonPath.length > 0) {
    console.log('Python bundling successful!');
    console.log('Executable exists:', fs.existsSync(pythonPath[0]));
    
    // Try to execute the Python version
    const { spawnSync } = require('child_process');
    const result = spawnSync(pythonPath[0], ['--version']);
    
    console.log('Python version output:', result.stdout.toString().trim() || result.stderr.toString().trim());
} else {
    console.log('No bundled Python found');
}
`;
    
    // Write the temporary JavaScript file
    fs.writeFileSync(tempJsPath, jsCode);
    
    try {
        // Execute the test file
        require(tempJsPath);
    } catch (error) {
        console.error('Error running test:', error);
    }
    
    // Clean up the temporary file
    fs.unlinkSync(tempJsPath);
}

testPythonBundling();