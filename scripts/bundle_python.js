#!/usr/bin/env node
/**
 * Python Bundler for MightyDev Extension
 * 
 * This script downloads and bundles Python for the VSCode extension.
 * It ensures that the extension can run in environments without Python installed.
 * 
 * Usage:
 *   node bundle_python.js
 * 
 * Options:
 *   --platform=[win32|darwin|linux]  Specify platform to bundle for
 *   --all                          Bundle for all platforms
 */

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const tar = require('tar');
const tmp = require('tmp');

// Configuration
const config = {
    // Platform specific Python URLs
    python: {
        win32: {
            url: 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip',
            extension: '.zip'
        },
        darwin: {
            url: 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-macOS-universal2.pkg',
            extension: '.pkg'
        },
        linux: {
            url: 'https://www.python.org/ftp/python/3.10.11/Python-3.10.11.tgz',
            extension: '.tgz'
        }
    },
    // VS Code marketplace API endpoint
    vsMarketplace: {
        url: 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{extension}/{version}/vspackage'
    },
    
    // Local paths
    paths: {
        root: path.resolve(__dirname, '..'),
        pythonDir: path.resolve(__dirname, '..', 'python'),
        tempDir: tmp.dirSync().name,
        requirements: path.resolve(__dirname, '..', 'requirements.txt')
    }
};

/**
 * Downloads a file from a URL
 */
function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading ${url} to ${destination}...`);
        
        // Use require for better module handling
        const protocol = url.startsWith('https:') ? require('https') : require('http');
        const file = fs.createWriteStream(destination);
        
        const handleResponse = (response) => {
            // Handle redirects (status codes 301, 302, 307, 308)
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                console.log(`Following redirect to ${response.headers.location}`);
                
                // Close the previous write stream
                file.close();
                
                // Start a new request with the new URL
                downloadFile(response.headers.location, destination)
                    .then(resolve)
                    .catch(reject);
                
                return;
            }
            
            // Check for successful response
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            
            // Pipe the response to the file
            response.pipe(file);
            
            // Handle completion
            file.on('finish', () => {
                file.close();
                console.log('Download completed');
                resolve();
            });
            
            // Handle errors
            file.on('error', (err) => {
                fs.unlink(destination, () => {}); // Delete the file on error
                reject(err);
            });
        };
        
        // Start the request
        const request = protocol.get(url, handleResponse);
        
        // Handle errors
        request.on('error', (err) => {
            fs.unlink(destination, () => {}); // Delete the file on error
            reject(err);
        });
        
        // Set a reasonable timeout
        request.setTimeout(30000, () => {
            request.destroy();
            fs.unlink(destination, () => {}); // Delete the file on error
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Creates a launcher script for Python
 */
function createLauncher(platform, pythonDir) {
    console.log(`Creating launcher for ${platform}...`);
    
    const launcherPath = path.join(pythonDir, platform, 'python_launcher.js');
    const pythonExe = platform === 'win32' ? 'python.exe' : 'bin/python3';
    
    const launcherContent = `
    #!/usr/bin/env node
    const { spawn } = require('child_process');
    const path = require('path');

    // Get the path to the bundled Python executable
    const pythonPath = path.join(__dirname, '${pythonExe}');
    
    // Forward all arguments to Python
    const args = process.argv.slice(2);
    
    // Spawn Python process
    const proc = spawn(pythonPath, args, {
        stdio: 'inherit',
        env: process.env
    });
    
    // Handle process exit
    proc.on('exit', code => {
        process.exit(code);
    });
    `;
    
    fs.writeFileSync(launcherPath, launcherContent);
    
    // Make executable on Unix platforms
    if (platform !== 'win32') {
        fs.chmodSync(launcherPath, '755');
    }
    
    console.log(`Launcher created at ${launcherPath}`);
}

/**
 * Bundles Python for Windows
 */
async function bundleWindowsPython() {
    const platform = 'win32';
    const pythonConfig = config.python[platform];
    const pythonDir = path.join(config.paths.pythonDir, platform);
    
    // Create directory
    fs.ensureDirSync(pythonDir);
    
    // Download Python
    const zipPath = path.join(config.paths.tempDir, `python${pythonConfig.extension}`);
    await downloadFile(pythonConfig.url, zipPath);
    
    // Extract zip
    console.log(`Extracting to ${pythonDir}...`);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(pythonDir);
    
    // Create launcher
    createLauncher(platform, config.paths.pythonDir);
    
    // Copy requirements.txt
    fs.copyFileSync(config.paths.requirements, path.join(pythonDir, 'requirements.txt'));
    
    console.log(`Windows Python bundled successfully to ${pythonDir}`);
}

/**
 * Bundles Python for macOS
 */
async function bundleMacOSPython() {
    const platform = 'darwin';
    const pythonConfig = config.python[platform];
    const pythonDir = path.join(config.paths.pythonDir, platform);
    
    // Create directory
    fs.ensureDirSync(pythonDir);
    
    // For macOS, we'll use a pre-built standalone Python from GitHub
    const modifiedUrl = 'https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.10.13+20240107-x86_64-apple-darwin-install_only.tar.gz';
    
    console.log(`Using modified URL for macOS: ${modifiedUrl}`);
    
    // Download Python
    const archivePath = path.join(config.paths.tempDir, 'python-macos.tar.gz');
    await downloadFile(modifiedUrl, archivePath);
    
    // Create bin and lib directories
    fs.ensureDirSync(path.join(pythonDir, 'bin'));
    fs.ensureDirSync(path.join(pythonDir, 'lib'));
    
    // Extract tarball directly to the python directory
    console.log(`Extracting to ${pythonDir}...`);
    await tar.extract({
        file: archivePath,
        cwd: pythonDir
    });
    
    // For the standalone Python build, we should now have a python directory structure
    // The executable should be at pythonDir/python/bin/python3
    const extractedPythonBin = path.join(pythonDir, 'python', 'bin', 'python3');
    
    if (fs.existsSync(extractedPythonBin)) {
        console.log(`Found extracted Python executable at ${extractedPythonBin}`);
        
        // Create bin directory if it doesn't exist
        const binDir = path.join(pythonDir, 'bin');
        fs.ensureDirSync(binDir);
        
        // Create a symlink or copy the Python executable to the standard location
        const pythonExe = path.join(binDir, 'python3');
        
        try {
            // Try to create a symlink first
            fs.symlinkSync(extractedPythonBin, pythonExe);
            console.log(`Created symlink from ${extractedPythonBin} to ${pythonExe}`);
        } catch (error) {
            // If symlink fails, copy the file instead
            console.log(`Couldn't create symlink, copying file instead: ${error.message}`);
            fs.copyFileSync(extractedPythonBin, pythonExe);
            fs.chmodSync(pythonExe, '755');
        }
    } else {
        console.log('Extracted Python not found, using system Python as fallback');
        
        // Create bin directory
        const binDir = path.join(pythonDir, 'bin');
        fs.ensureDirSync(binDir);
        
        // Find system Python
        const systemPython = '/usr/bin/python3';
        if (fs.existsSync(systemPython)) {
            console.log(`Using system Python at ${systemPython} as a fallback`);
            
            // Create a wrapper script that calls the system Python
            const pythonExe = path.join(binDir, 'python3');
            fs.writeFileSync(pythonExe, `#!/bin/bash
# This is a wrapper that calls the system Python
exec ${systemPython} "$@"
`);
            fs.chmodSync(pythonExe, '755');
        } else {
            console.error('Could not find system Python to use as fallback');
            throw new Error('Python bundling failed: No system Python available');
        }
    }
    
    // Create launcher
    createLauncher(platform, config.paths.pythonDir);
    
    // Copy requirements.txt
    fs.copyFileSync(config.paths.requirements, path.join(pythonDir, 'requirements.txt'));
    
    console.log(`macOS Python bundled successfully to ${pythonDir}`);
}

/**
 * Bundles Python for Linux
 */
async function bundleLinuxPython() {
    const platform = 'linux';
    const pythonConfig = config.python[platform];
    const pythonDir = path.join(config.paths.pythonDir, platform);
    
    // Create directory
    fs.ensureDirSync(pythonDir);
    
    // For Linux, we'll download a pre-built binary tarball
    const modifiedUrl = 'https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.10.13+20240107-x86_64-unknown-linux-gnu-install_only.tar.gz';
    
    console.log(`Using standalone Python build for Linux: ${modifiedUrl}`);
    
    // Download Python
    const tgzPath = path.join(config.paths.tempDir, 'python-linux.tar.gz');
    await downloadFile(modifiedUrl, tgzPath);
    
    // Extract tarball directly to the python directory
    console.log(`Extracting to ${pythonDir}...`);
    await tar.extract({
        file: tgzPath,
        cwd: pythonDir
    });
    
    // If the extraction worked, we should have a python.bin directory
    const extractedBinDir = path.join(pythonDir, 'python', 'bin');
    const extractedPython = path.join(extractedBinDir, 'python3');
    
    if (fs.existsSync(extractedPython)) {
        console.log(`Found extracted Python executable at ${extractedPython}`);
        
        // Create bin directory if it doesn't exist
        const binDir = path.join(pythonDir, 'bin');
        fs.ensureDirSync(binDir);
        
        // Create a symlink or copy the Python executable
        const pythonExe = path.join(binDir, 'python3');
        try {
            fs.symlinkSync(extractedPython, pythonExe);
            console.log(`Created symlink from ${extractedPython} to ${pythonExe}`);
        } catch (error) {
            console.log(`Couldn't create symlink, copying file instead: ${error.message}`);
            fs.copyFileSync(extractedPython, pythonExe);
            fs.chmodSync(pythonExe, '755');
        }
    } else {
        // Fallback to system Python if extraction fails
        console.log('Extracted Python not found, using system Python as fallback');
        
        // Create bin directory
        const binDir = path.join(pythonDir, 'bin');
        fs.ensureDirSync(binDir);
        
        // Create a wrapper that calls system Python
        const pythonExe = path.join(binDir, 'python3');
        fs.writeFileSync(pythonExe, `#!/bin/bash
# This is a wrapper that calls the system Python
exec /usr/bin/env python3 "$@"
`);
        fs.chmodSync(pythonExe, '755');
    }
    
    // Create launcher
    createLauncher(platform, config.paths.pythonDir);
    
    // Copy requirements.txt
    fs.copyFileSync(config.paths.requirements, path.join(pythonDir, 'requirements.txt'));
    
    console.log(`Linux Python bundled successfully to ${pythonDir}`);
}

/**
 * Main function
 */
async function main() {
    try {
        console.log('Starting Python bundling process...');
        
        // Parse command line arguments
        const args = process.argv.slice(2);
        let platforms = [];
        
        if (args.includes('--all')) {
            platforms = ['win32', 'darwin', 'linux'];
        } else {
            const platformArg = args.find(arg => arg.startsWith('--platform='));
            if (platformArg) {
                const platform = platformArg.split('=')[1];
                if (['win32', 'darwin', 'linux'].includes(platform)) {
                    platforms.push(platform);
                } else {
                    console.error(`Invalid platform: ${platform}`);
                    process.exit(1);
                }
            } else {
                // Default to current platform
                platforms.push(process.platform);
            }
        }
        
        // Create Python directory
        fs.ensureDirSync(config.paths.pythonDir);
        
        // Bundle Python for each platform
        for (const platform of platforms) {
            console.log(`\nBundling Python for ${platform}...`);
            
            if (platform === 'win32') {
                await bundleWindowsPython();
            } else if (platform === 'darwin') {
                await bundleMacOSPython();
            } else if (platform === 'linux') {
                await bundleLinuxPython();
            }
        }
        
        console.log('\nPython bundling completed successfully!');
    } catch (error) {
        console.error('Error bundling Python:', error);
        process.exit(1);
    }
}

main();