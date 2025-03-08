#!/usr/bin/env python3
"""
MightyDev Extension Setup

This script sets up the MightyDev extension environment, including:
1. Creating a virtual environment for CrewAI
2. Installing required dependencies
3. Verifying the installation

Usage:
    python setup.py
"""

import os
import sys
import shutil
import subprocess
import platform
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).parent.absolute()
VENV_PATH = PROJECT_ROOT / "crewai_venv"
ENV_FILE = PROJECT_ROOT / ".env"

def check_pip():
    """Check if pip is installed and working"""
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "--version"], 
                             stdout=subprocess.DEVNULL)
        return True
    except subprocess.CalledProcessError:
        print("pip is not installed or not working properly.")
        return False

def create_venv():
    """Create a virtual environment for CrewAI"""
    print(f"Creating virtual environment at: {VENV_PATH}")
    
    # Remove existing venv if it exists
    if VENV_PATH.exists():
        print("Removing existing virtual environment...")
        shutil.rmtree(VENV_PATH)
    
    # Create a new virtual environment
    subprocess.run([sys.executable, "-m", "venv", str(VENV_PATH)], check=True)
    
    # Get the Python and pip paths
    if os.name == "nt":  # Windows
        python_path = VENV_PATH / "Scripts" / "python.exe"
        pip_path = VENV_PATH / "Scripts" / "pip.exe"
    else:  # Unix/Linux/MacOS
        python_path = VENV_PATH / "bin" / "python"
        pip_path = VENV_PATH / "bin" / "pip"
    
    return python_path, pip_path

def install_dependencies(python_path, pip_path):
    """Install required dependencies in the virtual environment"""
    print("Installing required dependencies...")
    
    # Upgrade pip
    subprocess.run([str(pip_path), "install", "--upgrade", "pip"], check=True)
    
    # Install uv for faster package installation
    subprocess.run([str(pip_path), "install", "uv"], check=True)
    
    # Install CrewAI and other dependencies using uv
    # Use the python_path as a parameter to make sure uv uses the correct interpreter
    uv_path = VENV_PATH / "bin" / "uv" if os.name != "nt" else VENV_PATH / "Scripts" / "uv.exe"
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = str(VENV_PATH)
    
    # Tell uv to use the Python interpreter in our venv
    subprocess.run([
        str(uv_path), "pip", "install",
        "--python", str(python_path),
        "crewai", "pygls", "lsprotocol", "cattrs"
    ], env=env, check=True)
    
    print("✅ Dependencies installed successfully!")

def verify_installation(python_path):
    """Verify that CrewAI is installed correctly"""
    print("\nVerifying installation...")
    
    result = subprocess.run(
        [str(python_path), "-c", "import crewai; print(f'CrewAI version: {crewai.__version__}')"],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print(result.stdout.strip())
        print("✅ CrewAI installed successfully!")
        return True
    else:
        print("❌ Failed to import CrewAI:")
        print(result.stderr)
        return False

def create_env_file():
    """Create a .env file for API keys if it doesn't exist"""
    if not ENV_FILE.exists():
        print("\nCreating .env file for API keys...")
        with open(ENV_FILE, "w") as f:
            f.write("# Add your API keys below\n")
            f.write("ANTHROPIC_API_KEY=your_anthropic_api_key_here\n")
            f.write("OPENAI_API_KEY=your_openai_api_key_here\n")
        print(f"Created .env file at: {ENV_FILE}")
        print("Please update the file with your actual API keys.")
    else:
        print(f"\n.env file already exists at: {ENV_FILE}")
        
        # Check if API keys are set
        with open(ENV_FILE, "r") as f:
            env_content = f.read()
            
        if "ANTHROPIC_API_KEY=your_anthropic_api_key_here" in env_content:
            print("⚠️ You need to update your Anthropic API key in the .env file")
        elif "ANTHROPIC_API_KEY=" in env_content:
            print("🔑 Found Anthropic API key in .env file")
            
        if "OPENAI_API_KEY=your_openai_api_key_here" in env_content:
            print("⚠️ You need to update your OpenAI API key in the .env file")
        elif "OPENAI_API_KEY=" in env_content:
            print("🔑 Found OpenAI API key in .env file")

def main():
    """Main setup function"""
    print("MightyDev Setup Script")
    print("======================")
    
    # Check Python version
    py_version = platform.python_version()
    print(f"Python version: {py_version}")
    
    if not check_pip():
        print("❌ Cannot proceed without pip. Please install pip and try again.")
        return 1
    
    try:
        # Create virtual environment
        python_path, pip_path = create_venv()
        
        # Install dependencies
        install_dependencies(python_path, pip_path)
        
        # Verify installation
        success = verify_installation(python_path)
        
        # Create .env file
        create_env_file()
        
        if success:
            print("\n✅ Setup completed successfully!")
            print(f"Virtual environment: {VENV_PATH}")
            print("The MightyDev extension is now ready to use.")
            return 0
        else:
            print("\n❌ Setup failed. Please check the error messages above.")
            return 1
            
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Setup failed: {e}")
        return 1
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())