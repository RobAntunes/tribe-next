#!/usr/bin/env python3
"""
Start CrewAI Server

This script starts the CrewAI server using the Python interpreter from the
dedicated virtual environment created by setup.py.
"""

import os
import sys
import subprocess
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).parent.absolute()
VENV_PATH = PROJECT_ROOT / "crewai_venv"
SERVER_SCRIPT = PROJECT_ROOT / "bundled" / "tool" / "crewai_server.py"

def find_python_interpreter():
    """Find the Python interpreter in the virtual environment"""
    # Check for Python in the virtual environment
    if os.name == "nt":  # Windows
        python_path = VENV_PATH / "Scripts" / "python.exe"
    else:  # Unix/Linux/MacOS
        python_path = VENV_PATH / "bin" / "python"
        
    if python_path.exists():
        return python_path
    
    # If not found, try system Python
    try:
        which_result = subprocess.run(
            ["which", "python3"], capture_output=True, text=True, check=True
        )
        return Path(which_result.stdout.strip())
    except (subprocess.SubprocessError, FileNotFoundError):
        print("Error: Could not find Python interpreter")
        return None

def main():
    """Main function to start the CrewAI server"""
    # Find Python interpreter
    python_path = find_python_interpreter()
    if not python_path:
        sys.exit(1)
        
    # Check if server script exists
    if not SERVER_SCRIPT.exists():
        print(f"Error: Server script not found at {SERVER_SCRIPT}")
        sys.exit(1)
    
    # Current working directory
    cwd = str(PROJECT_ROOT)
    
    # Run the server
    try:
        print(f"Starting CrewAI server with {python_path}")
        print(f"Using project path: {cwd}")
        
        # Set up environment variables
        env = os.environ.copy()
        env["PYTHONPATH"] = f"{cwd}:{env.get('PYTHONPATH', '')}"
        
        # Run the server
        subprocess.run(
            [str(python_path), str(SERVER_SCRIPT), "--project-path", cwd],
            env=env,
            check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"Error starting CrewAI server: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nServer stopped by user")

if __name__ == "__main__":
    main()