#!/bin/bash
# MightyDev Initialization Script
# This script initializes the MightyDev extension by setting up the Python environment
# and bundling Python if needed.

set -e  # Exit on error

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_DIR="$ROOT_DIR/python"

echo "==================================================="
echo "  MightyDev Extension Initialization"
echo "==================================================="
echo "Root directory: $ROOT_DIR"

# Check Python version
PYTHON_VERSION=$(python --version 2>&1)
echo "Detected Python: $PYTHON_VERSION"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python -m venv "$VENV_DIR"
    echo "Virtual environment created at $VENV_DIR"
else
    echo "Using existing virtual environment at $VENV_DIR"
fi

# Activate virtual environment
if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
elif [ -f "$VENV_DIR/Scripts/activate" ]; then
    source "$VENV_DIR/Scripts/activate"
else
    echo "Error: Could not find activation script for virtual environment"
    exit 1
fi

# Upgrade pip, setuptools, and wheel
echo "Upgrading pip, setuptools, and wheel..."
python -m pip install --upgrade pip setuptools wheel

# Install dependencies
echo "Installing dependencies..."
python -m pip install -r "$ROOT_DIR/requirements.txt"

# Bundle Python if it doesn't exist
if [ ! -d "$PYTHON_DIR" ]; then
    echo "Bundling Python..."
    
    # Determine the current platform for bundling
    PLATFORM=""
    case "$(uname -s)" in
        Darwin*)
            PLATFORM="darwin"
            ;;
        Linux*)
            PLATFORM="linux"
            ;;
        CYGWIN*|MINGW*|MSYS*)
            PLATFORM="win32"
            ;;
        *)
            echo "Unknown platform, will try to detect automatically"
            ;;
    esac
    
    if [ -n "$PLATFORM" ]; then
        echo "Detected platform: $PLATFORM"
        node "$SCRIPT_DIR/bundle_python.js" --platform="$PLATFORM"
    else
        # If platform detection failed, bundle for the current platform
        node "$SCRIPT_DIR/bundle_python.js"
    fi
    
    # Verify the bundled Python
    PLATFORM_DIR="$PYTHON_DIR/$PLATFORM"
    if [ "$PLATFORM" = "win32" ]; then
        PYTHON_BIN="$PLATFORM_DIR/python.exe"
    else
        PYTHON_BIN="$PLATFORM_DIR/bin/python3"
    fi
    
    if [ -e "$PYTHON_BIN" ]; then
        echo "Python bundled successfully at $PYTHON_BIN"
        
        # Test the bundled Python
        if [ "$PLATFORM" != "win32" ]; then
            echo "Testing bundled Python..."
            "$PYTHON_BIN" --version
            if [ $? -eq 0 ]; then
                echo "Bundled Python is working correctly"
            else
                echo "Warning: Bundled Python may not be working correctly"
                echo "Falling back to system Python..."
            fi
        fi
    else
        echo "Warning: Bundled Python executable not found at $PYTHON_BIN"
        echo "Will fall back to system Python or Python extension"
    fi
else
    echo "Using existing bundled Python at $PYTHON_DIR"
fi

echo "==================================================="
echo "MightyDev initialization completed successfully!"
echo "==================================================="