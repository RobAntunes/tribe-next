#!/usr/bin/env python3

import os
import sys
from pathlib import Path

# Add the virtual environment site-packages to the path
venv_site_packages = Path(__file__).parent / "crewai_venv" / "lib" / "python3.13" / "site-packages"
if venv_site_packages.exists():
    sys.path.insert(0, str(venv_site_packages))
else:
    # Try Python 3.10 path as fallback
    venv_site_packages = Path(__file__).parent / "crewai_venv" / "lib" / "python3.10" / "site-packages"
    if venv_site_packages.exists():
        sys.path.insert(0, str(venv_site_packages))

print(f"Python version: {sys.version}")
print(f"Python interpreter: {sys.executable}")
print(f"Looking for packages in: {venv_site_packages}")

try:
    import crewai
    from crewai import Agent, Task, Crew, Process, LLM
    print(f"CrewAI version: {crewai.__version__}")
    print("CrewAI imported successfully!")
    
    # If you have API keys, you can create a simple agent and test it
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if api_key:
        # Create a simple agent
        agent = Agent(
            role="Senior Developer",
            goal="Write high-quality code",
            backstory="You are an experienced developer who writes clean, maintainable code."
        )
        
        # Create a simple task
        task = Task(
            description="Write a simple function that adds two numbers",
            expected_output="A clean, simple Python function that adds two numbers",
            agent=agent
        )
        
        # Create a crew
        crew = Crew(
            agents=[agent],
            tasks=[task],
            process=Process.sequential
        )
        
        # We won't actually run the crew since it would use API credits
        print("Crew created successfully")
    else:
        print("No API keys found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment to test the full functionality.")
    
except Exception as e:
    print(f"Error: {e}")