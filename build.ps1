# Unified build script for MightyDev VSCode Extension (PowerShell version)

# Print banner
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  MightyDev Extension Build Script   " -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Check if npm is installed
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: npm is not installed or not in your PATH" -ForegroundColor Red
    exit 1
}

# Function to show a step
function Show-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "🔧 $Message" -ForegroundColor Yellow
    Write-Host "----------------------------------" -ForegroundColor Yellow
}

# Parse command line arguments
param(
    [switch]$Clean,
    [switch]$Dev,
    [switch]$Package,
    [switch]$Help
)

# Show help if requested
if ($Help) {
    Write-Host "Usage: ./build.ps1 [-Clean] [-Dev] [-Package] [-Help]"
    Write-Host "Options:"
    Write-Host "  -Clean    Clean build outputs before building"
    Write-Host "  -Dev      Start in development (watch) mode"
    Write-Host "  -Package  Build VSIX package"
    Write-Host "  -Help     Show this help message"
    exit 0
}

# Clean if requested
if ($Clean) {
    Show-Step "Cleaning previous builds"
    npm run clean
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Show-Step "Installing extension dependencies"
    npm install
}
else {
    Write-Host "Extension dependencies already installed"
}

# Install webview dependencies if needed
if (-not (Test-Path "webview/node_modules")) {
    Show-Step "Installing webview dependencies"
    Push-Location webview
    npm install
    Pop-Location
}
else {
    Write-Host "Webview dependencies already installed"
}

# Start dev mode if requested
if ($Dev) {
    Show-Step "Starting development mode"
    npm run dev
    exit 0
}

# Build webview
Show-Step "Building webview"
Push-Location webview
npm run build
Pop-Location

# Build extension
Show-Step "Building extension"
npm run package

# Package if requested
if ($Package) {
    Show-Step "Creating VSIX package"
    npm run vsce-package
    
    # Show package info
    $vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
    if ($vsixFile) {
        Write-Host "✅ Package created: $($vsixFile.Name)" -ForegroundColor Green
    }
    else {
        Write-Host "❌ Failed to create VSIX package" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "✅ Build completed successfully!" -ForegroundColor Green
Write-Host ""

# Provide next steps
Write-Host "Next steps:"
if ($Package) {
    if ($vsixFile) {
        Write-Host "- Install the extension: code --install-extension $($vsixFile.Name)"
    }
}
else {
    Write-Host "- Run the extension with F5 in VSCode"
    Write-Host "- Package the extension: ./build.ps1 -Package"
}
Write-Host ""