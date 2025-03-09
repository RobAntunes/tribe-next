#!/usr/bin/env python3
"""
CrewAI Adapter

This module provides compatibility between different versions of CrewAI.
It adapts the older version of CrewAI (0.11.0) to match the expected interface
of the newer version (0.102.0) used in crewai_server.py.

It also extends the base CrewAI classes to enable dynamic runtime creation of:
- Agents
- Tasks
- Tools
- Team assignments
"""

# First try to import from crewai_venv, if it exists
import os
import sys
import json
import logging
import inspect
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Callable

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("crewai_adapter")

# Add potential virtual environment paths to Python path
venv_paths = [
    # Custom crewai_venv for Python 3.13
    Path(__file__).parent.parent.parent / "crewai_venv" / "lib" / "python3.13" / "site-packages",
    # Custom crewai_venv for Python 3.10
    Path(__file__).parent.parent.parent / "crewai_venv" / "lib" / "python3.10" / "site-packages",
    # Default .venv
    Path(__file__).parent.parent.parent / ".venv" / "lib" / "python3.10" / "site-packages",
]

# Add all existing venv paths to sys.path
for venv_path in venv_paths:
    if venv_path.exists():
        if str(venv_path) not in sys.path:
            sys.path.insert(0, str(venv_path))
        logger.info(f"Added virtual environment to Python path: {venv_path}")

# Fix missing modules and monkey patch issues
try:
    # Step 1: First try to fix typing_extensions issue
    try:
        import typing_extensions
        # Check if TypeIs is missing from typing_extensions
        if not hasattr(typing_extensions, 'TypeIs'):
            # Add TypeIs to typing_extensions as a workaround
            setattr(typing_extensions, 'TypeIs', type)
            logger.info("Added missing TypeIs to typing_extensions")
    except ImportError:
        logger.warning("Could not import typing_extensions")
    
    # Step 2: Try to install missing packages if needed
    try:
        import importlib.util
        missing_packages = []
        
        # Check for key packages
        for package in ["crewai", "langchain", "anthropic", "openai"]:
            if importlib.util.find_spec(package) is None:
                missing_packages.append(package)
        
        # If we're missing critical packages, try to install them
        if missing_packages:
            logger.warning(f"Missing required packages: {', '.join(missing_packages)}")
            
            # Try to install using pip
            try:
                import pip
                for package in missing_packages:
                    logger.info(f"Attempting to install {package}...")
                    pip.main(["install", package, "--quiet"])
            except Exception as install_err:
                logger.error(f"Failed to install packages: {install_err}")
    except Exception as check_err:
        logger.error(f"Error checking/installing missing packages: {check_err}")
        
except Exception as e:
    logger.error(f"Error during dependency fixing: {e}")

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
        
    logger.info(f"CrewAI version {crewai.__version__} imported successfully")
    
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
    
    # Extended base classes for dynamic runtime creation
    class ExtendedAgent(Agent):
        """
        Extended Agent class that adds support for:
        - Character-like names and personalities
        - Stylistic properties
        - Metadata
        """
        def __init__(self, 
                     role: str, 
                     goal: str, 
                     backstory: str, 
                     name: str = None,
                     character_name: str = None,
                     tone: str = None,
                     learning_style: str = None,
                     working_style: str = None,
                     communication_style: str = None,
                     quirks: List[str] = None,
                     metadata: Dict[str, Any] = None,
                     **kwargs):
            # Initialize the base Agent
            super().__init__(role=role, goal=goal, backstory=backstory, **kwargs)
            
            # Store extended properties
            self.character_name = character_name or name or role
            self.tone = tone or "Professional"
            self.learning_style = learning_style or "Analytical"
            self.working_style = working_style or "Methodical"
            self.communication_style = communication_style or "Clear and concise"
            self.quirks = quirks or []
            self.metadata = metadata or {}
            
            # Add stylistic information to system prompt if not provided explicitly
            if self.system_template is None:
                self._add_personality_to_prompt()

        def _add_personality_to_prompt(self):
            """Add personality metadata to the agent's system prompt"""
            if hasattr(self, "system_prompt"):
                # Add personality section at the end of the system prompt
                personality_section = f"""
                
# Character Information
You are {self.character_name}, a {self.role}. You communicate in a {self.tone} tone with a {self.communication_style} communication style.
Your learning style is {self.learning_style} and you work in a {self.working_style} manner.
"""
                
                # Add quirks if any
                if self.quirks:
                    quirks_text = ", ".join(self.quirks)
                    personality_section += f"\nYou have the following quirks: {quirks_text}. These may subtly influence your communication style."
                
                # Update the system prompt
                if isinstance(self.system_prompt, str):
                    self.system_prompt += personality_section
        
        def to_dict(self) -> Dict[str, Any]:
            """Convert agent to a serializable dictionary"""
            # Get base class attributes
            base_attrs = {
                "role": self.role,
                "goal": self.goal,
                "backstory": self.backstory,
            }
            
            # Add CrewAI 0.102.0+ attributes
            for attr in ["verbose", "allow_delegation", "max_iter", "max_rpm"]:
                if hasattr(self, attr):
                    base_attrs[attr] = getattr(self, attr)
            
            # Add extended attributes
            extended_attrs = {
                "character_name": self.character_name,
                "tone": self.tone,
                "learning_style": self.learning_style,
                "working_style": self.working_style,
                "communication_style": self.communication_style,
                "quirks": self.quirks,
                "metadata": self.metadata
            }
            
            return {**base_attrs, **extended_attrs}
        
        @classmethod
        def from_dict(cls, data: Dict[str, Any]) -> 'ExtendedAgent':
            """Create an agent from a dictionary"""
            return cls(**data)
            
    class ExtendedTask(Task):
        """
        Extended Task class that adds support for:
        - Subtasks
        - Dependencies
        - Execution modes
        - Task metadata
        """
        def __init__(self, 
                     description: str, 
                     agent=None, 
                     expected_output: str = None,
                     execution_mode: str = "sequential",
                     subtasks: List['ExtendedTask'] = None,
                     dependencies: List[str] = None,
                     metadata: Dict[str, Any] = None,
                     **kwargs):
            # Initialize the base Task
            super().__init__(description=description, agent=agent, expected_output=expected_output, **kwargs)
            
            # Store extended properties
            self.execution_mode = execution_mode  # sequential, async, parallel, concurrent
            self.subtasks = subtasks or []
            self.dependencies = dependencies or []
            self.metadata = metadata or {}
            self.task_id = metadata.get("id", None) if metadata else None
        
        def to_dict(self) -> Dict[str, Any]:
            """Convert task to a serializable dictionary"""
            # Get base attributes
            base_attrs = {
                "description": self.description,
                "expected_output": self.expected_output,
            }
            
            # Handle agent (reference by ID)
            if hasattr(self.agent, "metadata") and self.agent.metadata.get("id"):
                base_attrs["agent_id"] = self.agent.metadata.get("id")
            
            # Add extended attributes
            extended_attrs = {
                "execution_mode": self.execution_mode,
                "dependencies": self.dependencies,
                "metadata": self.metadata,
            }
            
            # Add subtasks (flattened to IDs)
            if self.subtasks:
                subtask_ids = []
                for subtask in self.subtasks:
                    if hasattr(subtask, "task_id") and subtask.task_id:
                        subtask_ids.append(subtask.task_id)
                extended_attrs["subtask_ids"] = subtask_ids
            
            return {**base_attrs, **extended_attrs}
        
        @classmethod
        def from_dict(cls, data: Dict[str, Any], agents_dict: Dict[str, 'ExtendedAgent'] = None) -> 'ExtendedTask':
            """Create a task from a dictionary"""
            # Handle agent reference
            agent = None
            if agents_dict and "agent_id" in data and data["agent_id"] in agents_dict:
                agent = agents_dict[data["agent_id"]]
            
            # Create task without subtasks (they'll be added later)
            task_data = data.copy()
            task_data.pop("subtask_ids", None)
            task_data.pop("agent_id", None)
            task_data["agent"] = agent
            
            return cls(**task_data)

    # Tool base class with JSON schema support
    class Tool:
        """
        Base Tool class for creating tools that can be used by agents
        """
        def __init__(self, name: str, description: str, func: Callable):
            self.name = name
            self.description = description
            self.func = func
            
            # Validate the function has docstring and type hints
            self._validate_function()
        
        def _validate_function(self):
            """Validate that the function is properly documented"""
            if not self.func.__doc__:
                logger.warning(f"Tool {self.name} function lacks docstring")
            
            # Check for type hints
            sig = inspect.signature(self.func)
            for param_name, param in sig.parameters.items():
                if param.annotation is inspect.Parameter.empty:
                    logger.warning(f"Tool {self.name} parameter {param_name} lacks type hint")
            
            if sig.return_annotation is inspect.Parameter.empty:
                logger.warning(f"Tool {self.name} lacks return type hint")
        
        def __call__(self, *args, **kwargs):
            """Make the tool callable"""
            return self.func(*args, **kwargs)
        
        def to_dict(self) -> Dict[str, Any]:
            """Convert tool to a serializable dictionary"""
            return {
                "name": self.name,
                "description": self.description,
            }
    
    # JSON Structured Output Tools
    class StructuredJSONOutputTool(Tool):
        """
        Tool for enforcing a specific JSON output schema from models
        that don't natively support structured outputs
        """
        def __init__(self, schema: Dict[str, Any]):
            def structured_json_output(input_str: str) -> Dict[str, Any]:
                """
                Convert input into a JSON object that follows the specified schema.
                
                Args:
                    input_str: The string to convert to structured JSON
                    
                Returns:
                    A dictionary conforming to the schema
                """
                try:
                    # Extract JSON from the input (handle cases where there's text surrounding it)
                    import re
                    import json
                    
                    # Look for JSON blocks in the content
                    json_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
                    json_matches = re.findall(json_pattern, input_str)
                    
                    if json_matches:
                        # Try each JSON block until we find a valid one
                        for json_str in json_matches:
                            try:
                                data = json.loads(json_str)
                                # TODO: Validate against schema
                                return data
                            except json.JSONDecodeError:
                                continue
                    
                    # If no JSON blocks or none are valid, try the whole string
                    try:
                        data = json.loads(input_str)
                        # TODO: Validate against schema
                        return data
                    except json.JSONDecodeError:
                        # As a last resort, try to extract JSON-like patterns
                        json_like_pattern = r'{[\s\S]*}'
                        match = re.search(json_like_pattern, input_str)
                        if match:
                            try:
                                data = json.loads(match.group(0))
                                # TODO: Validate against schema
                                return data
                            except json.JSONDecodeError:
                                pass
                    
                    # If all attempts failed, return an error object
                    return {
                        "error": "Failed to parse JSON from input",
                        "input": input_str
                    }
                    
                except Exception as e:
                    return {
                        "error": str(e),
                        "input": input_str
                    }
            
            super().__init__(
                name="structured_json_output",
                description=f"Enforces that output follows a specific JSON schema: {json.dumps(schema, indent=2)}",
                func=structured_json_output
            )
            
            self.schema = schema
    
    class ExtractJSONTool(Tool):
        """
        Tool for extracting and validating JSON from text
        """
        def __init__(self):
            def extract_json(input_str: str) -> Dict[str, Any]:
                """
                Extract JSON from a text string.
                
                Args:
                    input_str: The string from which to extract JSON
                    
                Returns:
                    The extracted JSON as a dictionary
                """
                try:
                    import re
                    import json
                    
                    # Look for JSON blocks in the content
                    json_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
                    json_matches = re.findall(json_pattern, input_str)
                    
                    if json_matches:
                        # Try each JSON block until we find a valid one
                        for json_str in json_matches:
                            try:
                                return json.loads(json_str)
                            except json.JSONDecodeError:
                                continue
                    
                    # If no JSON blocks or none are valid, try the whole string
                    try:
                        return json.loads(input_str)
                    except json.JSONDecodeError:
                        # As a last resort, try to extract JSON-like patterns
                        json_like_pattern = r'{[\s\S]*}'
                        match = re.search(json_like_pattern, input_str)
                        if match:
                            try:
                                return json.loads(match.group(0))
                            except json.JSONDecodeError:
                                pass
                    
                    # If all attempts failed, return an error object
                    return {
                        "error": "Failed to extract valid JSON",
                        "input": input_str
                    }
                    
                except Exception as e:
                    return {
                        "error": str(e),
                        "input": input_str
                    }
            
            super().__init__(
                name="extract_json",
                description="Extracts and validates JSON from text input",
                func=extract_json
            )
    
    # Register extended classes
    setattr(crewai, "ExtendedAgent", ExtendedAgent)
    setattr(crewai, "ExtendedTask", ExtendedTask)
    setattr(crewai, "Tool", Tool)
    setattr(crewai, "StructuredJSONOutputTool", StructuredJSONOutputTool)
    setattr(crewai, "ExtractJSONTool", ExtractJSONTool)
    
except ImportError as e:
    logger.error(f"Failed to import CrewAI: {e}")
    
    # Create dummy classes for basic functionality
    class Agent:
        def __init__(self, role, goal, backstory, **kwargs):
            self.role = role
            self.goal = goal
            self.backstory = backstory
            self.name = kwargs.get("name", role)
            
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
            return "CrewAI is not properly installed. Please install the latest version of CrewAI."
            
    class LLM:
        def __init__(self, provider, model=None, api_key=None, **kwargs):
            self.provider = provider
            self.model = model
            self.api_key = api_key
            
    class Process:
        sequential = "sequential"
        hierarchical = "hierarchical"
    
    # Extended base classes as fallbacks
    class ExtendedAgent(Agent):
        """Fallback Extended Agent class"""
        def __init__(self, role, goal, backstory, **kwargs):
            super().__init__(role=role, goal=goal, backstory=backstory, **kwargs)
            self.character_name = kwargs.get("character_name", role)
            self.tone = kwargs.get("tone", "Professional")
            self.learning_style = kwargs.get("learning_style", "Analytical")
            self.working_style = kwargs.get("working_style", "Methodical")
            self.communication_style = kwargs.get("communication_style", "Clear and concise")
            self.quirks = kwargs.get("quirks", [])
            self.metadata = kwargs.get("metadata", {})
            
        def to_dict(self):
            return {
                "role": self.role,
                "goal": self.goal,
                "backstory": self.backstory,
                "character_name": self.character_name,
                "metadata": self.metadata
            }
            
        @classmethod
        def from_dict(cls, data):
            return cls(**data)
            
    class ExtendedTask(Task):
        """Fallback Extended Task class"""
        def __init__(self, description, agent=None, expected_output=None, **kwargs):
            super().__init__(description=description, agent=agent, expected_output=expected_output)
            self.execution_mode = kwargs.get("execution_mode", "sequential")
            self.subtasks = kwargs.get("subtasks", [])
            self.dependencies = kwargs.get("dependencies", [])
            self.metadata = kwargs.get("metadata", {})
            self.task_id = kwargs.get("task_id", None)
            
        def to_dict(self):
            return {
                "description": self.description,
                "expected_output": self.expected_output,
                "execution_mode": self.execution_mode,
                "metadata": self.metadata,
            }
            
        @classmethod
        def from_dict(cls, data, agents_dict=None):
            return cls(**data)
            
    class Tool:
        """Fallback Tool class"""
        def __init__(self, name, description, func):
            self.name = name
            self.description = description
            self.func = func
            
        def __call__(self, *args, **kwargs):
            return f"Tool {self.name} called, but CrewAI is not properly installed."
            
        def to_dict(self):
            return {
                "name": self.name,
                "description": self.description,
            }
            
    class StructuredJSONOutputTool(Tool):
        """Fallback JSON Output Tool"""
        def __init__(self, schema):
            super().__init__(
                name="structured_json_output",
                description="Enforces JSON schema (unavailable)",
                func=lambda x: {"error": "CrewAI not installed"}
            )
            self.schema = schema
            
    class ExtractJSONTool(Tool):
        """Fallback JSON Extraction Tool"""
        def __init__(self):
            super().__init__(
                name="extract_json",
                description="Extracts JSON (unavailable)",
                func=lambda x: {"error": "CrewAI not installed"}
            )
        
    # Export dummy classes
    __all__ = [
        "Agent", "Task", "Crew", "LLM", "Process", 
        "ExtendedAgent", "ExtendedTask", "Tool",
        "StructuredJSONOutputTool", "ExtractJSONTool"
    ]