#!/usr/bin/env python3
"""
CrewAI Adapter

This module provides interfaces to the CrewAI library for MightyDev.
It imports the required classes from CrewAI and provides any additional
functionality needed for the extension.
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Callable

# Fix for missing TypeIs in typing_extensions
try:
    import typing_extensions
    if not hasattr(typing_extensions, 'TypeIs'):
        # Add TypeIs to typing_extensions as a workaround
        setattr(typing_extensions, 'TypeIs', type)
        print("Added missing TypeIs to typing_extensions")
except ImportError:
    print("Could not import typing_extensions")

import crewai
from crewai import Agent, Task, Crew, Process, LLM

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("crewai_adapter")

# Utility function to ensure result is always a string when CrewAI needs it
def ensure_string_output(result):
    """Convert dictionary results to strings for compatibility with CrewAI validation"""
    # CrewAI sometimes requires strings for TaskOutput validation
    if isinstance(result, (dict, list)):
        try:
            import json
            return json.dumps(result, indent=2)
        except Exception:
            return str(result)
    elif result is None:
        return ""
    
    return result

# Add potential virtual environment paths to Python path
venv_paths = [
    # Custom crewai_venv for Python 3.13
    Path(__file__).parent.parent.parent / "crewai_venv" / "lib" / "python3.13" / "site-packages",
    # Custom crewai_venv for Python 3.10
    Path(__file__).parent.parent.parent / "crewai_venv" / "lib" / "python3.10" / "site-packages",
]

# Add all existing venv paths to sys.path
for venv_path in venv_paths:
    if venv_path.exists():
        if str(venv_path) not in sys.path:
            sys.path.insert(0, str(venv_path))
        logger.info(f"Added virtual environment to Python path: {venv_path}")

logger.info(f"CrewAI version {crewai.__version__} imported successfully")

# Log the successful import of required components
logger.info("Successfully imported core CrewAI components")
