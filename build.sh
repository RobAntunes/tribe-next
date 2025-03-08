#!/bin/bash
# Unified build script for MightyDev VSCode Extension

set -e  # Exit on error

# Print banner
echo "====================================="
echo "  MightyDev Extension Build Script   "
echo "====================================="

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed or not in your PATH"
    exit 1
fi

# Function to show a step
show_step() {
    echo
    echo "🔧 $1"
    echo "----------------------------------"
}

# Parse command line arguments
CLEAN=false
DEV=false
PACKAGE=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -c|--clean) CLEAN=true ;;
        -d|--dev) DEV=true ;;
        -p|--package) PACKAGE=true ;;
        -h|--help) 
            echo "Usage: ./build.sh [options]"
            echo "Options:"
            echo "  -c, --clean    Clean build outputs before building"
            echo "  -d, --dev      Start in development (watch) mode"
            echo "  -p, --package  Build VSIX package"
            echo "  -h, --help     Show this help message"
            exit 0
            ;;
        *) 
            echo "Unknown parameter: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
    shift
done

# Clean if requested
if [ "$CLEAN" = true ]; then
    show_step "Cleaning previous builds"
    npm run clean
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    show_step "Installing extension dependencies"
    npm install
else
    echo "Extension dependencies already installed"
fi

# Install webview dependencies if needed
if [ ! -d "webview/node_modules" ]; then
    show_step "Installing webview dependencies"
    cd webview && npm install && cd ..
else
    echo "Webview dependencies already installed"
fi

# Start dev mode if requested
if [ "$DEV" = true ]; then
    show_step "Starting development mode"
    npm run dev
    exit 0
fi

# Build webview
show_step "Building webview"
cd webview && npm run build && cd ..

# Build extension
show_step "Building extension"
npm run package

# Package if requested
if [ "$PACKAGE" = true ]; then
    show_step "Creating VSIX package"
    npm run vsce-package
    
    # Show package info
    VSIX_FILE=$(ls *.vsix | head -n 1)
    if [ -n "$VSIX_FILE" ]; then
        echo "✅ Package created: $VSIX_FILE"
    else
        echo "❌ Failed to create VSIX package"
        exit 1
    fi
fi

echo
echo "✅ Build completed successfully!"
echo

# Provide next steps
echo "Next steps:"
if [ "$PACKAGE" = true ]; then
    echo "- Install the extension: code --install-extension $VSIX_FILE"
else
    echo "- Run the extension with F5 in VSCode"
    echo "- Package the extension: ./build.sh --package"
fi
echo