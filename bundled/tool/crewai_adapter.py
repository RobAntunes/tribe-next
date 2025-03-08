#!/usr/bin/env python3
"""
CrewAI Adapter

This module provides compatibility between different versions of CrewAI.
It adapts the older version of CrewAI (0.11.0) to match the expected interface
of the newer version (0.102.0) used in crewai_server.py.
"""

# First try to import from crewai_venv, if it exists
import os
import sys
from pathlib import Path

# Add potential virtual environment paths to Python path
venv_paths = [
    # Custom crewai_venv
    Path(__file__).parent.parent.parent / "crewai_venv" / "lib" / "python3.10" / "site-packages",
    # Default .venv
    Path(__file__).parent.parent.parent / ".venv" / "lib" / "python3.10" / "site-packages",
]

# Add all existing venv paths to sys.path
for venv_path in venv_paths:
    if venv_path.exists():
        if str(venv_path) not in sys.path:
            sys.path.insert(0, str(venv_path))
        print(f"Added virtual environment to Python path: {venv_path}")

# Now try to import CrewAI
try:
    import crewai
    from crewai import Agent, Task, Crew
    
    # Check if LLM is directly in crewai or in a submodule
    try:
        # Newer version (0.102.0+)
        from crewai import LLM
        HAS_DIRECT_LLM = True
    except ImportError:
        # Older version (0.11.0)
        from crewai.agents.cache import Cache
        from crewai.utilities import Language
        HAS_DIRECT_LLM = False
        
    print(f"CrewAI version {crewai.__version__} imported successfully")
    
    # Create adapter for LLM class if using older version
    if not HAS_DIRECT_LLM:
        class LLM:
            """
            Adapter for older CrewAI versions that don't have the LLM class directly.
            """
            def __init__(self, provider, model=None, api_key=None, **kwargs):
                self.provider = provider
                self.model = model
                self.api_key = api_key
                self.kwargs = kwargs
                
            def __repr__(self):
                return f"LLM(provider={self.provider}, model={self.model})"
        
        # Add LLM to crewai module
        setattr(crewai, "LLM", LLM)
        
        # Monkey patch Process enum if needed
        if not hasattr(crewai, "Process"):
            class Process:
                sequential = "sequential"
                hierarchical = "hierarchical"
                
            setattr(crewai, "Process", Process)
    
except ImportError as e:
    print(f"Failed to import CrewAI: {e}")
    
    # Create dummy classes for basic functionality
    class Agent:
        def __init__(self, role, goal, backstory, **kwargs):
            self.role = role
            self.goal = goal
            self.backstory = backstory
            
    class Task:
        def __init__(self, description, agent=None, expected_output=None):
            self.description = description
            self.agent = agent
            self.expected_output = expected_output
            
    class Crew:
        def __init__(self, agents, tasks, **kwargs):
            self.agents = agents
            self.tasks = tasks
            
        def kickoff(self):
            return "CrewAI is not properly installed. Please install with: pip install crewai==0.11.0"
            
    class LLM:
        def __init__(self, provider, model=None, api_key=None, **kwargs):
            self.provider = provider
            self.model = model
            self.api_key = api_key
            
    class Process:
        sequential = "sequential"
        hierarchical = "hierarchical"
        
    # Export dummy classes
    __all__ = ["Agent", "Task", "Crew", "LLM", "Process"]