#!/usr/bin/env python3
"""
Setup Python Environment for MightyDev Extension

This script:
1. Creates a virtual environment
2. Installs required dependencies
3. Bundles Python for distribution with the extension

Usage:
    python setup_python.py
"""

import os
import sys
import subprocess
import platform
import shutil
import venv
import argparse
import urllib.request
import zipfile
import tarfile
import tempfile
import json
import datetime
from pathlib import Path

# Determine Python version for the URL
PY_VERSION = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"

# Extension root directory (parent of script directory)
SCRIPT_DIR = Path(__file__).resolve().parent
EXTENSION_ROOT = SCRIPT_DIR.parent
PYTHON_DIR = EXTENSION_ROOT / "python"
VENV_DIR = EXTENSION_ROOT / ".venv"
PYTHONBIN_DIR = EXTENSION_ROOT / "pythonbin"

# Define platform-specific values
PLATFORM = platform.system().lower()
if PLATFORM == "windows":
    PYTHON_EXE = VENV_DIR / "Scripts" / "python.exe"
    PYTHON_ZIP_NAME = f"python-{PY_VERSION}-embed-amd64.zip"
    PLATFORM_NAME = "win32"
elif PLATFORM == "darwin":
    PYTHON_EXE = VENV_DIR / "bin" / "python"
    PYTHON_ZIP_NAME = f"python-{PY_VERSION}-macos.tar.gz"
    PLATFORM_NAME = "darwin"
else:  # Linux
    PYTHON_EXE = VENV_DIR / "bin" / "python"
    PYTHON_ZIP_NAME = f"python-{PY_VERSION}-linux.tar.gz"
    PLATFORM_NAME = "linux"


def create_venv():
    """Create a virtual environment"""
    print(f"Creating virtual environment at {VENV_DIR}...")
    
    # Create directory if it doesn't exist
    if not VENV_DIR.exists():
        venv.create(VENV_DIR, with_pip=True)
        print("Virtual environment created successfully")
    else:
        print("Virtual environment already exists")
    
    # Ensure pip and setuptools are up to date
    print("Upgrading pip and setuptools...")
    subprocess.check_call([str(PYTHON_EXE), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])


def install_requirements():
    """Install requirements from requirements.txt"""
    requirements_file = EXTENSION_ROOT / "requirements.txt"
    
    if not requirements_file.exists():
        print("Warning: requirements.txt not found!")
        return
    
    print("Installing requirements...")
    subprocess.check_call([str(PYTHON_EXE), "-m", "pip", "install", "-r", str(requirements_file)])
    print("Requirements installed successfully")


def download_python():
    """
    Download and bundle Python for the extension
    
    This function initiates the Node.js script for downloading and bundling Python
    instead of trying to implement the bundling directly in Python.
    """
    print(f"Downloading and bundling Python {PY_VERSION} for {PLATFORM}...")
    
    # Node.js script path
    bundle_script = SCRIPT_DIR / "bundle_python.js"
    
    if not bundle_script.exists():
        print(f"Error: bundle_python.js script not found at {bundle_script}")
        return False
    
    # Determine which platform to bundle for
    bundle_args = []
    if len(sys.argv) > 1 and "--all" in sys.argv:
        bundle_args.append("--all")
    else:
        bundle_args.append(f"--platform={PLATFORM_NAME}")
    
    # Execute the Node.js bundling script
    print(f"Executing: node {bundle_script} {' '.join(bundle_args)}")
    try:
        result = subprocess.run(
            ["node", str(bundle_script)] + bundle_args,
            check=True,
            capture_output=True,
            text=True
        )
        print(result.stdout)
        if result.stderr:
            print(f"Warnings/Errors: {result.stderr}")
        
        # Check if the bundled Python exists
        python_dir = EXTENSION_ROOT / "python" / PLATFORM_NAME
        python_bin = python_dir / "bin" / "python3"
        if PLATFORM_NAME == "win32":
            python_bin = python_dir / "python.exe"
        
        if python_bin.exists():
            print(f"Successfully bundled Python at {python_bin}")
            
            # Create metadata file
            metadata = {
                "python_version": PY_VERSION,
                "platform": PLATFORM_NAME,
                "date_created": datetime.datetime.now().isoformat(),
                "bundled_by": "bundle_python.js"
            }
            
            os.makedirs(python_dir, exist_ok=True)
            with open(python_dir / "metadata.json", "w") as f:
                json.dump(metadata, f, indent=2)
            
            return True
        else:
            print(f"Warning: Bundled Python executable not found at {python_bin}")
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"Error executing bundle_python.js: {e}")
        if e.stdout:
            print(f"Output: {e.stdout}")
        if e.stderr:
            print(f"Error: {e.stderr}")
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        return False


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Setup Python environment for MightyDev Extension")
    parser.add_argument("--venv-only", action="store_true", help="Only create virtual environment and install dependencies")
    parser.add_argument("--bundle-only", action="store_true", help="Only bundle Python for distribution")
    
    args = parser.parse_args()
    
    if args.venv_only or not args.bundle_only:
        create_venv()
        install_requirements()
    
    if args.bundle_only or not args.venv_only:
        download_python()
    
    print("Python setup completed successfully!")


if __name__ == "__main__":
    main()