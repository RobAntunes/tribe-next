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
        - Memory and embeddings
        """
        def __init__(self, 
                     role: str, 
                     goal: str, 
                     backstory: str, 
                     name: str = None,
                     character_name: str = None,  # Keep for backward compatibility
                     tone: str = None,
                     learning_style: str = None,
                     working_style: str = None,
                     communication_style: str = None,
                     traits: List[str] = None,
                     quirks: List[str] = None,
                     metadata: Dict[str, Any] = None,
                     **kwargs):
            # Use character_name as a fallback for name to maintain compatibility
            name_to_use = name or character_name or role
            
            # Always ensure memory is enabled
            if 'memory' not in kwargs:
                kwargs['memory'] = True
                
            # Set up sentence-transformers embeddings if not specified
            if 'embedder' not in kwargs:
                try:
                    # Use sentence transformers for embeddings
                    try:
                        from langchain_huggingface import HuggingFaceEmbeddings
                        sentence_transformer_model = "all-MiniLM-L6-v2"  # Lightweight model good for semantic search
                        # Create embedder config dictionary instead of passing the object directly
                        kwargs['embedder'] = {
                            "provider": "huggingface",
                            "model": sentence_transformer_model
                        }
                        logger.info(f"Initialized sentence-transformers embeddings config with model {sentence_transformer_model}")
                    except ImportError:
                        # Fall back to default embeddings
                        logger.warning("Could not import HuggingFaceEmbeddings - will use default CrewAI embeddings")
                except Exception as e:
                    logger.warning(f"Error setting up embeddings: {str(e)} - will use default CrewAI embeddings")
            
            # Initialize the base Agent without passing name parameter
            # This avoids issues with older versions that don't accept name
            super().__init__(role=role, goal=goal, backstory=backstory, **kwargs)
            
            # Store all our properties in the agent's __dict__ to avoid attribute errors
            agent_dict = self.__dict__
            agent_dict['_name'] = name_to_use  # Use _name instead of name to avoid conflicts
            agent_dict['tone'] = tone or "Professional"
            agent_dict['learning_style'] = learning_style or "Analytical"
            agent_dict['working_style'] = working_style or "Methodical"
            agent_dict['communication_style'] = communication_style or "Clear and concise"
            agent_dict['traits'] = traits or []
            agent_dict['quirks'] = quirks or []
            
            # Ensure metadata exists
            if metadata:
                agent_dict['metadata'] = metadata
            elif not hasattr(self, 'metadata') or not self.metadata:
                agent_dict['metadata'] = {}
            
            # Always add name to metadata for retrieval
            if isinstance(agent_dict.get('metadata', {}), dict):
                agent_dict['metadata']['name'] = name_to_use
                agent_dict['metadata']['character_name'] = name_to_use  # For backward compatibility
            
            # Add stylistic information to system prompt if not provided explicitly
            if not hasattr(self, 'system_template') or self.system_template is None:
                self._add_personality_to_prompt()
                
        # Override _process_message to ensure metadata is included with each prompt
        def _process_message(self, message: str, *args, **kwargs):
            """
            Process a message from the user, ensuring metadata is attached to each prompt.
            This ensures that agent metadata is consistently included with every message
            to the foundation model, not just at agent creation time.
            
            Args:
                message: The message to process
                *args: Additional positional arguments
                **kwargs: Additional keyword arguments
                
            Returns:
                The processed response
            """
            try:
                # Make sure learning context is updated from metadata before processing
                self._ensure_metadata_in_prompt()
                
                # Log detailed information about the message and system prompt
                logger.info(f"Processing message for agent: {self.name}")
                logger.info(f"User message: {message[:100]}..." if len(message) > 100 else f"User message: {message}")
                
                # Get the agent dictionary
                agent_dict = self.__dict__
                
                # Log the complete system prompt so we can see if personality traits are included
                system_prompt = agent_dict.get("system_prompt", "")
                if isinstance(system_prompt, str) and system_prompt:
                    system_length = len(system_prompt)
                    logger.info(f"System prompt length: {system_length} characters")
                    
                    # Log the first part of the system prompt
                    first_part = system_prompt[:500] + "..." if system_length > 500 else system_prompt
                    logger.info(f"System prompt (first part): {first_part}")
                    
                    # Log specifically if the character information section exists
                    if "# Character Information" in system_prompt:
                        char_info_idx = system_prompt.find("# Character Information")
                        char_info_section = system_prompt[char_info_idx:char_info_idx+500] + "..." if system_length - char_info_idx > 500 else system_prompt[char_info_idx:]
                        logger.info(f"Character Information section: {char_info_section}")
                    else:
                        logger.warning("NO CHARACTER INFORMATION SECTION FOUND IN SYSTEM PROMPT!")
                else:
                    logger.warning("Agent does not have a valid system_prompt!")
                
                # Call the parent class's _process_message method with the updated context
                return super()._process_message(message, *args, **kwargs)
            except Exception as e:
                logger.error(f"Error processing message with metadata: {e}")
                # Fall back to the parent class's method if our enhancement fails
                return super()._process_message(message, *args, **kwargs)
                
        def _ensure_metadata_in_prompt(self):
            """
            Ensure all metadata is included in the system prompt before each message.
            This updates the system prompt with the latest metadata, ensuring each
            message to the foundation model includes up-to-date context.
            """
            try:
                # Force adding metadata regardless of current state
                # Always apply personality and traits to each message
                
                # Check if we can directly access system_prompt
                try:
                    # Try to access system_prompt to see if it exists
                    if hasattr(self, "system_prompt"):
                        has_system_prompt = True
                    else:
                        # Check if __dict__ contains system_prompt
                        agent_dict = self.__dict__
                        has_system_prompt = "system_prompt" in agent_dict
                        
                        # If not in __dict__, try to add it
                        if not has_system_prompt:
                            agent_dict["system_prompt"] = f"You are {self.name}, a {self.role}."
                            has_system_prompt = True
                except Exception as attr_err:
                    logger.warning(f"Error checking system_prompt attribute: {attr_err}")
                    # Create system_prompt in __dict__
                    self.__dict__["system_prompt"] = f"You are {self.name}, a {self.role}."
                    has_system_prompt = True
                
                # Now update the system prompt
                agent_dict = self.__dict__
                if has_system_prompt:
                    # Check if our special section is already in the prompt, if so, update it
                    system_prompt = agent_dict.get("system_prompt", "")
                    if isinstance(system_prompt, str) and "# Character Information" in system_prompt:
                        # First save the original part of the prompt (before our additions)
                        original_prompt = system_prompt.split("# Character Information")[0]
                        
                        # Now set the system prompt to the original part
                        agent_dict["system_prompt"] = original_prompt
                        
                        # Re-add the personality section with current metadata
                        self._add_personality_to_prompt()
                        logger.info(f"Refreshed agent personality traits for {self.name}")
                    else:
                        # Just add the personality section if it doesn't exist
                        self._add_personality_to_prompt()
                        logger.info(f"Added agent personality traits for {self.name}")
                else:
                    # If we couldn't establish a system_prompt, log it but don't fail
                    logger.warning(f"Could not establish system_prompt for agent {self.name}")
            except Exception as e:
                logger.error(f"Error ensuring metadata in prompt: {e}")
                # Continue without updating if there's an error
                
        @property
        def name(self):
            """Safe property to get name from various places"""
            if hasattr(self, '_name') and self._name:
                return self._name
            if hasattr(self, 'metadata') and isinstance(self.metadata, dict) and 'name' in self.metadata:
                return self.metadata['name']
            if hasattr(self, 'metadata') and isinstance(self.metadata, dict) and 'character_name' in self.metadata:
                return self.metadata['character_name']
            return self.role

        def _add_personality_to_prompt(self):
            """Add personality metadata to the agent's system prompt"""
            try:
                # Get agent dictionary
                agent_dict = self.__dict__
                
                # Get agent name and role safely
                agent_name = self.name
                agent_role = self.role
                
                # Ensure tone and styles have default values
                tone = getattr(self, 'tone', 'Professional') 
                communication_style = getattr(self, 'communication_style', 'Clear and concise')
                learning_style = getattr(self, 'learning_style', 'Analytical')
                working_style = getattr(self, 'working_style', 'Methodical')
                
                # Start with agent identity information
                personality_section = f"""

# Character Information
You are {agent_name}, a {agent_role}. You communicate in a {tone} tone with a {communication_style} communication style.
Your learning style is {learning_style} and you work in a {working_style} manner.
"""
                
                # Add personality traits if any
                traits = getattr(self, 'traits', [])
                if traits and len(traits) > 0:
                    if isinstance(traits, list):
                        traits_text = ", ".join(traits)
                        personality_section += f"\nYour personality traits include: {traits_text}. These are inherent aspects of your character."
                    elif isinstance(traits, str):
                        personality_section += f"\nYour personality traits include: {traits}. These are inherent aspects of your character."
                
                # Add quirks if any
                quirks = getattr(self, 'quirks', [])
                if quirks and len(quirks) > 0:
                    if isinstance(quirks, list):
                        quirks_text = ", ".join(quirks)
                        personality_section += f"\nYou have the following quirks: {quirks_text}. These are unique qualities that make you distinctive."
                    elif isinstance(quirks, str):
                        personality_section += f"\nYou have the following quirks: {quirks}. These are unique qualities that make you distinctive."
                
                # Add available tools information if present
                if hasattr(self, 'tools') and self.tools:
                    tool_names = [getattr(tool, 'name', str(tool)) for tool in self.tools]
                    personality_section += f"\n\nYou have access to the following tools: {', '.join(tool_names)}."
                
                # Add metadata from the metadata dictionary if it exists
                if hasattr(self, 'metadata') and isinstance(self.metadata, dict):
                    # Add any learning context or other relevant metadata
                    if 'learning_context' in self.metadata:
                        personality_section += f"\n\n{self.metadata['learning_context']}"
                    
                    # Add any specific skills if present
                    if 'skills' in self.metadata:
                        skills = self.metadata['skills']
                        if isinstance(skills, list):
                            skills_text = ", ".join(skills)
                            personality_section += f"\n\nYour specialized skills include: {skills_text}."
                        elif isinstance(skills, str):
                            personality_section += f"\n\nYour specialized skills include: {skills}."
                
                # Add a reminder about showing personality consistently
                personality_section += "\n\nIMPORTANT: Make sure your responses consistently reflect your unique tone, traits, quirks, and communication style."
                
                # Add memory context reminder
                personality_section += "\n\n# Memory System\nYou have access to a comprehensive memory system that stores your past interactions and knowledge. This memory system uses sentence-transformers embeddings to find relevant information based on semantic similarity. With each message, you automatically receive context from:\n1. Recent conversation history\n2. Similar past interactions\n3. Relevant files and code you've worked with\n\nYou should use this memory context to maintain continuity in conversations and leverage past knowledge to better assist users. This memory system is separate from but complementary to the learning system tool. Your memories are automatically retrieved when semantically similar topics arise, but you can also use the learning_system tool to explicitly store and retrieve knowledge."
                
                # Add tool awareness reminder
                personality_section += "\n\n# Tool Awareness\nYou have access to multiple tools that extend your capabilities. Always be mindful of which tools are available to you, as they are core to your functionality. Use these tools appropriately to accomplish your goals and provide the best assistance possible."
                
                # Update the system prompt
                if "system_prompt" in agent_dict:
                    current_prompt = agent_dict["system_prompt"]
                    if isinstance(current_prompt, str):
                        agent_dict["system_prompt"] = current_prompt + personality_section
                    else:
                        # If system_prompt exists but isn't a string, set it as a string
                        agent_dict["system_prompt"] = f"You are {agent_name}, a {agent_role}." + personality_section
                else:
                    # If system_prompt doesn't exist, create it
                    agent_dict["system_prompt"] = f"You are {agent_name}, a {agent_role}." + personality_section
                
                # Log the personality information being added
                logger.info(f"Added personality information for {agent_name}: tone={tone}, style={communication_style}")
                if traits and len(traits) > 0:
                    logger.info(f"Added traits for {agent_name}: {traits}")
                if quirks and len(quirks) > 0:
                    logger.info(f"Added quirks for {agent_name}: {quirks}")
                logger.info("Added memory system and tool awareness to system prompt")
            except Exception as e:
                logger.error(f"Error adding personality to prompt: {e}")
                # Continue without updating if there's an error
        
        def to_dict(self) -> Dict[str, Any]:
            """Convert agent to a serializable dictionary"""
            # Get base class attributes (using our name property)
            base_attrs = {
                "role": self.role,
                "goal": self.goal,
                "backstory": self.backstory,
                "name": self.name,  # Use the name property which safely gets from anywhere
                "character_name": self.name,  # Add for backward compatibility
            }
            
            # Add CrewAI 0.102.0+ attributes
            for attr in ["verbose", "allow_delegation", "max_iter", "max_rpm"]:
                if hasattr(self, attr):
                    base_attrs[attr] = getattr(self, attr)
            
            # Add extended attributes
            extended_attrs = {
                "tone": self.tone,
                "learning_style": self.learning_style,
                "working_style": self.working_style,
                "communication_style": self.communication_style,
                "traits": self.traits,
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
            
        # Override the execute method to ensure string output
        def execute(self, *args, **kwargs):
            """
            Execute the task and ensure the result is properly formatted as a string
            when that's what CrewAI expects for TaskOutput validation.
            
            Returns:
                The result, converted to a string if it's a dictionary/list
            """
            try:
                # Call the original execute method
                result = super().execute(*args, **kwargs)
                
                # Ensure result is properly formatted as a string if needed
                return ensure_string_output(result)
            except Exception as e:
                logger.error(f"Error executing task: {e}")
                # Return error message as a string
                return f"Error executing task: {str(e)}"
        
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
        
        def result_as_answer(self, result: Any) -> str:
            """
            Format the result as a user-friendly answer.
            This method is required by CrewAI 0.28.0+.
            
            Args:
                result: The result from the tool invocation
                
            Returns:
                A string representation of the result
            """
            # Handle different result types appropriately
            if isinstance(result, (dict, list)):
                try:
                    import json
                    return json.dumps(result, indent=2)
                except Exception:
                    pass
            
            # Default to string conversion
            return str(result)
            
        def invoke(self, input_str: str = None, **kwargs) -> Any:
            """
            Invoke the tool on the given input string.
            This method makes the tool compatible with newer CrewAI versions.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The result of the tool invocation
            """
            # Handle case where input_str is not provided or empty
            if input_str is None or input_str == "":
                # Try to get input from kwargs
                if "input" in kwargs:
                    input_str = kwargs["input"]
                elif "query" in kwargs:
                    input_str = kwargs["query"]
                elif "text" in kwargs:
                    input_str = kwargs["text"]
                elif "content" in kwargs:
                    input_str = kwargs["content"]
                elif len(kwargs) > 0:
                    # Try to use the first kwargs value
                    input_str = next(iter(kwargs.values()))
                else:
                    # Fallback to empty string if no input is provided
                    input_str = ""
            
            # Call the function with the input
            return self.func(input_str)
        
        def run(self, input_str: str = None, **kwargs) -> Any:
            """
            Run method for LangChain compatibility.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The result of the tool invocation
            """
            # Get result using invoke and ensure it's a string if needed
            return self.invoke(input_str, **kwargs)
        
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
        that don't natively support structured outputs.
        
        This implementation aligns with CLAUDE.md section 3.8 for structured output tools.
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
                    
                    # Try to import jsonschema for validation, fallback to simple validation if not available
                    try:
                        import jsonschema
                        have_jsonschema = True
                    except ImportError:
                        have_jsonschema = False
                        logger.warning("jsonschema package not available, will use basic validation")
                    
                    # Look for JSON blocks in the content
                    json_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
                    json_matches = re.findall(json_pattern, input_str)
                    
                    if json_matches:
                        # Try each JSON block until we find a valid one
                        for json_str in json_matches:
                            try:
                                data = json.loads(json_str)
                                # Validate against schema if provided
                                if schema:
                                    if have_jsonschema:
                                        try:
                                            jsonschema.validate(instance=data, schema=schema)
                                            return data
                                        except jsonschema.exceptions.ValidationError as ve:
                                            # If validation fails, try the next match
                                            continue
                                    else:
                                        # Basic validation - just check required fields are present
                                        if "required" in schema and isinstance(schema["required"], list):
                                            missing_fields = [field for field in schema["required"] if field not in data]
                                            if missing_fields:
                                                # Missing required fields, try the next match
                                                continue
                                        # If we have properties with required fields, check those too
                                        if "properties" in schema and isinstance(schema["properties"], dict):
                                            invalid = False
                                            for prop_name, prop_schema in schema["properties"].items():
                                                if prop_name in data and "required" in prop_schema and isinstance(prop_schema["required"], list):
                                                    if not isinstance(data[prop_name], dict):
                                                        invalid = True
                                                        break
                                                    missing_fields = [field for field in prop_schema["required"] if field not in data[prop_name]]
                                                    if missing_fields:
                                                        invalid = True
                                                        break
                                            if invalid:
                                                continue
                                        return data
                                else:
                                    return data
                            except json.JSONDecodeError:
                                continue
                    
                    # If no JSON blocks or none are valid, try the whole string
                    try:
                        data = json.loads(input_str)
                        # Validate against schema if provided
                        if schema:
                            if have_jsonschema:
                                try:
                                    jsonschema.validate(instance=data, schema=schema)
                                    return data
                                except jsonschema.exceptions.ValidationError as ve:
                                    # If validation fails but we have data, include the error
                                    return {
                                        "error": f"JSON validation failed: {str(ve)}",
                                        "invalid_data": data
                                    }
                            else:
                                # Basic validation - just check required fields are present
                                if "required" in schema and isinstance(schema["required"], list):
                                    missing_fields = [field for field in schema["required"] if field not in data]
                                    if missing_fields:
                                        return {
                                            "error": f"JSON validation failed: Missing required fields: {', '.join(missing_fields)}",
                                            "invalid_data": data
                                        }
                                # If basic validation passes, return the data
                                return data
                        else:
                            return data
                    except json.JSONDecodeError:
                        # As a last resort, try to extract JSON-like patterns
                        json_like_pattern = r'{[\s\S]*}'
                        match = re.search(json_like_pattern, input_str)
                        if match:
                            try:
                                data = json.loads(match.group(0))
                                # Validate against schema if provided
                                if schema:
                                    if have_jsonschema:
                                        try:
                                            jsonschema.validate(instance=data, schema=schema)
                                            return data
                                        except jsonschema.exceptions.ValidationError as ve:
                                            # If validation fails but we have data, include the error
                                            return {
                                                "error": f"JSON validation failed: {str(ve)}",
                                                "invalid_data": data
                                            }
                                    else:
                                        # Basic validation - just check required fields are present
                                        if "required" in schema and isinstance(schema["required"], list):
                                            missing_fields = [field for field in schema["required"] if field not in data]
                                            if missing_fields:
                                                return {
                                                    "error": f"JSON validation failed: Missing required fields: {', '.join(missing_fields)}",
                                                    "invalid_data": data
                                                }
                                        # If basic validation passes, return the data
                                        return data
                                else:
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
            
            description = (
                f"Enforces that output follows a specific JSON schema. Use this tool to format your response as properly structured JSON.\n\n"
                f"Schema: {json.dumps(schema, indent=2)}\n\n"
                "Usage: Call this tool with your content and it will convert it to a properly formatted JSON object that matches the required schema."
            )
            
            super().__init__(
                name="structured_json_output",
                description=description,
                func=structured_json_output
            )
            
            self.schema = schema
            
        def invoke(self, input_str: str = None, **kwargs) -> Union[Dict[str, Any], str]:
            """
            Invoke the tool on the given input string.
            This method makes the tool compatible with newer CrewAI versions.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The structured JSON output or string
            """
            # Handle case where input_str is not provided or empty
            if input_str is None or input_str == "":
                # Try to get input from kwargs
                if "input" in kwargs:
                    input_str = kwargs["input"]
                elif "query" in kwargs:
                    input_str = kwargs["query"]
                elif "text" in kwargs:
                    input_str = kwargs["text"]
                elif "content" in kwargs:
                    input_str = kwargs["content"]
                elif len(kwargs) > 0:
                    # Try to use the first kwargs value
                    input_str = next(iter(kwargs.values()))
                else:
                    # Fallback to empty string if no input is provided
                    input_str = "{}"
            
            # If input_str is already a dict, convert it to JSON string
            if isinstance(input_str, (dict, list)):
                try:
                    import json
                    input_str = json.dumps(input_str)
                except Exception:
                    input_str = str(input_str)
            
            # Get the result
            result = self.func(input_str)
            
            # Use the common utility to ensure consistent string output
            return ensure_string_output(result)
            
        def result_as_answer(self, result: Dict[str, Any]) -> str:
            """
            Format the result as a user-friendly answer.
            
            Args:
                result: The result from the tool invocation
                
            Returns:
                A string representation of the result
            """
            try:
                import json
                return json.dumps(result, indent=2)
            except Exception:
                return str(result)
                
        def run(self, input_str: str = None, **kwargs) -> Union[Dict[str, Any], str]:
            """
            Run method for LangChain compatibility.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The structured JSON output or string
            """
            # Get result using invoke and ensure it's a string if needed
            result = self.invoke(input_str, **kwargs)
            return ensure_string_output(result)
    
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
                description="Extracts and validates JSON from text input. Use this tool when you need to extract JSON data from a text response.",
                func=extract_json
            )
            
        def invoke(self, input_str: str = None, **kwargs) -> Union[Dict[str, Any], str]:
            """
            Invoke the tool on the given input string.
            This method makes the tool compatible with newer CrewAI versions.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The extracted JSON data or string
            """
            # Handle case where input_str is not provided or empty
            if input_str is None or input_str == "":
                # Try to get input from kwargs
                if "input" in kwargs:
                    input_str = kwargs["input"]
                elif "query" in kwargs:
                    input_str = kwargs["query"]
                elif "text" in kwargs:
                    input_str = kwargs["text"]
                elif "content" in kwargs:
                    input_str = kwargs["content"]
                elif len(kwargs) > 0:
                    # Try to use the first kwargs value
                    input_str = next(iter(kwargs.values()))
                else:
                    # Fallback to empty string if no input is provided
                    input_str = "{}"
            
            # If input_str is already a dict, convert it to JSON string
            if isinstance(input_str, (dict, list)):
                try:
                    import json
                    input_str = json.dumps(input_str)
                except Exception:
                    input_str = str(input_str)
            
            # Get the result
            result = self.func(input_str)
            
            # Use the common utility to ensure consistent string output
            return ensure_string_output(result)
            
        def result_as_answer(self, result: Dict[str, Any]) -> str:
            """
            Format the result as a user-friendly answer.
            
            Args:
                result: The result from the tool invocation
                
            Returns:
                A string representation of the result
            """
            try:
                import json
                return json.dumps(result, indent=2)
            except Exception:
                return str(result)
                
        def run(self, input_str: str = None, **kwargs) -> Union[Dict[str, Any], str]:
            """
            Run method for LangChain compatibility.
            
            Args:
                input_str: The input string to process (optional)
                **kwargs: Additional keyword arguments
                
            Returns:
                The extracted JSON data or string
            """
            # Get result using invoke and ensure it's a string if needed
            result = self.invoke(input_str, **kwargs)
            return ensure_string_output(result)
    
    # Shell Execution Tool for safely running shell commands
    class ShellExecutionTool(Tool):
        """
        Tool for safely executing shell commands
        with security constraints and timeout capabilities.
        """
        def __init__(self):
            import os
            import subprocess
            import shlex
            import re
            
            def shell_execute(command: str, **kwargs) -> str:
                """
                Execute a shell command with security constraints and return the output.
                
                Args:
                    command: The command to execute
                    **kwargs: Additional options like 'cwd', 'timeout', etc.
                    
                Returns:
                    The command output with any errors
                """
                try:
                    # Security checks
                    if not command or not isinstance(command, str):
                        return "Error: Command must be a non-empty string"
                    
                    # Check for dangerous patterns
                    dangerous_patterns = [
                        r"rm\s+-rf\s+/",
                        r"sudo",
                        r"chmod\s+777",
                        r">\s*/dev/(null|sd[a-z])",
                        r"dd\s+if=.*\s+of=/dev/sd[a-z]"
                    ]
                    
                    for pattern in dangerous_patterns:
                        if re.search(pattern, command):
                            return f"Error: Command rejected for security reasons (matched dangerous pattern: {pattern})"
                    
                    # List of allowed commands - extend as needed with safe commands
                    allowed_commands = {
                        "ls", "dir", "cd", "pwd", "cat", "echo", "grep", "find",
                        "python", "python3", "pip", "pip3", "npm", "node",
                        "git", "mkdir", "touch", "rm", "cp", "mv", "diff"
                    }
                    
                    # Extract base command
                    base_command = shlex.split(command)[0]
                    
                    # Check if command is allowed
                    if "/" in base_command or "\\" in base_command:
                        # For path commands, extract the executable name
                        base_command = os.path.basename(base_command)
                    
                    if base_command not in allowed_commands:
                        return f"Error: Command '{base_command}' is not in the allowed list for security reasons"
                    
                    # Set execution options
                    cwd = kwargs.get("cwd")
                    timeout = kwargs.get("timeout", 30)  # Default 30 seconds timeout
                    env = kwargs.get("env")
                    
                    # Execute the command
                    logger.info(f"Executing shell command: {command}")
                    process = subprocess.run(
                        command,
                        shell=True,
                        cwd=cwd,
                        env=env,
                        timeout=timeout,
                        capture_output=True,
                        text=True
                    )
                    
                    # Format and return the result
                    result = f"Exit code: {process.returncode}\n\n"
                    
                    if process.stdout:
                        result += f"STDOUT:\n{process.stdout}\n\n"
                    
                    if process.stderr:
                        result += f"STDERR:\n{process.stderr}\n"
                    
                    return result.strip()
                except subprocess.TimeoutExpired:
                    return f"Error: Command timed out after {timeout} seconds"
                except Exception as e:
                    return f"Error executing command: {str(e)}"
            
            super().__init__(
                name="shell_execute",
                description="Execute shell commands safely with security constraints and timeout capabilities. "
                           "Only safe, allowed commands are permitted.",
                func=shell_execute
            )

    # Register extended classes
    setattr(crewai, "ExtendedAgent", ExtendedAgent)
    setattr(crewai, "ExtendedTask", ExtendedTask)
    setattr(crewai, "Tool", Tool)
    setattr(crewai, "StructuredJSONOutputTool", StructuredJSONOutputTool)
    setattr(crewai, "ExtractJSONTool", ExtractJSONTool)
    setattr(crewai, "ShellExecutionTool", ShellExecutionTool)
    
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
        
    # Create robust tool classes for maximum compatibility
    try:
        # First try importing pydantic for modern CrewAI versions
        from pydantic import BaseModel, Field, create_model
        from typing import Dict, Any, Callable, List, Union, Optional
        import json
        
        # Create a robust base tool that works with modern CrewAI
        class BaseTool(BaseModel):
            """Base tool class fully compatible with newer CrewAI versions."""
            name: str
            description: str
            function: Callable
            
            def __call__(self, *args, **kwargs):
                return self.function(*args, **kwargs)
                
            # Add dict conversion for older CrewAI versions
            def __dict__(self):
                return {"name": self.name, "description": self.description}
                
            # Make object serializable
            def __json__(self):
                return {"name": self.name, "description": self.description}
                
            # Add this for compatibility with langchain tools
            def to_langchain(self):
                try:
                    from langchain.tools import BaseTool as LangchainBaseTool
                    
                    class CompatTool(LangchainBaseTool):
                        name = self.name
                        description = self.description
                        
                        def _run(self, input_str):
                            return self.function(input_str)
                    
                    return CompatTool()
                except ImportError:
                    return self
    except ImportError:
        # Fallback simple tool implementation without pydantic
        class BaseTool:
            """Simple BaseTool implementation for older versions."""
            def __init__(self, name, description, function):
                self.name = name
                self.description = description
                self.function = function
                
            def __call__(self, *args, **kwargs):
                return self.function(*args, **kwargs)
                
            def __dict__(self):
                return {"name": self.name, "description": self.description}
                
            def __str__(self):
                return f"{self.name}: {self.description}"
    
    # Simplified StructuredJSONOutputTool implementation that only takes schema
    class StructuredJSONOutputTool:
        """Simple compatibility version of the StructuredJSONOutputTool."""
        def __init__(self, schema):
            # Only take the schema parameter
            self.schema = schema
            
            # Use fixed name/description to avoid compatibility issues
            # These are not passed as constructor arguments!
            self.name = "structured_json_output"
            self.description = f"Format output as JSON following schema"
            
            def format_json(text):
                """Format text as JSON according to schema."""
                try:
                    import json
                    import re
                    
                    # Try to extract existing JSON first
                    json_matches = re.findall(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
                    if json_matches:
                        for potential_json in json_matches:
                            try:
                                parsed = json.loads(potential_json)
                                return json.dumps(parsed, indent=2)
                            except:
                                continue
                    
                    # Try the whole text as JSON
                    try:
                        parsed = json.loads(text)
                        return json.dumps(parsed, indent=2)
                    except:
                        pass
                        
                    # Just return text if above fails
                    return text
                except Exception:
                    return text
            
            # Store the function
            self.function = format_json
        
        def __call__(self, *args, **kwargs):
            return self.function(*args, **kwargs)
        
        # Add invoke method for newer CrewAI versions
        def invoke(self, input_str=None, **kwargs):
            """Required for compatibility with newer CrewAI versions"""
            # Handle case where input_str is not provided or empty
            if input_str is None or input_str == "":
                # Try to get input from kwargs
                if "input" in kwargs:
                    input_str = kwargs["input"]
                elif "query" in kwargs:
                    input_str = kwargs["query"]
                elif "text" in kwargs:
                    input_str = kwargs["text"]
                elif "content" in kwargs:
                    input_str = kwargs["content"]
                elif len(kwargs) > 0:
                    # Try to use the first kwargs value
                    input_str = next(iter(kwargs.values()))
                else:
                    # Fallback to empty string if no input is provided
                    input_str = "{}"
            
            # If input_str is already a dict, convert it to JSON string
            if isinstance(input_str, (dict, list)):
                try:
                    import json
                    input_str = json.dumps(input_str)
                except Exception:
                    input_str = str(input_str)
            
            # Get the result
            result = self.function(input_str)
            
            # Use the common utility to ensure consistent string output
            return ensure_string_output(result)
        
        # Add result_as_answer method for newer CrewAI versions
        def result_as_answer(self, result):
            """Format result as a user-friendly answer"""
            try:
                import json
                if isinstance(result, (dict, list)):
                    return json.dumps(result, indent=2)
                return str(result)
            except Exception:
                return str(result)
        
        # Add run method for LangChain compatibility
        def run(self, input_str=None, **kwargs):
            """For LangChain compatibility"""
            # Get result using invoke and ensure it's a string if needed
            result = self.invoke(input_str, **kwargs)
            return ensure_string_output(result)
            
        def __dict__(self):
            return {"schema": self.schema}
    
    # Simplified ExtractJSONTool implementation
    class ExtractJSONTool:
        """Simple compatibility version of the ExtractJSONTool."""
        def __init__(self):
            # Fixed properties - no constructor parameters
            self.name = "extract_json"
            self.description = "Extract and parse JSON from text"
            
            def extract_json(text):
                """Extract JSON from text with robust error handling."""
                try:
                    import json
                    import re
                    
                    # Look for code blocks first
                    json_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
                    json_matches = re.findall(json_pattern, text)
                    
                    if json_matches:
                        # Try each match
                        for json_str in json_matches:
                            try:
                                result = json.loads(json_str)
                                return json.dumps(result, indent=2)
                            except:
                                continue
                    
                    # Try the whole text
                    try:
                        result = json.loads(text)
                        return json.dumps(result, indent=2)
                    except:
                        pass
                    
                    # Try finding objects with regex as last resort
                    try:
                        json_object_pattern = r'{[\s\S]*}'
                        match = re.search(json_object_pattern, text)
                        if match:
                            obj_text = match.group(0)
                            result = json.loads(obj_text)
                            return json.dumps(result, indent=2)
                    except:
                        pass
                        
                    return text
                except Exception:
                    return text
            
            # Store the function
            self.function = extract_json
        
        def __call__(self, *args, **kwargs):
            return self.function(*args, **kwargs)
            
        # Add invoke method for newer CrewAI versions
        def invoke(self, input_str=None, **kwargs):
            """Required for compatibility with newer CrewAI versions"""
            # Handle case where input_str is not provided or empty
            if input_str is None or input_str == "":
                # Try to get input from kwargs
                if "input" in kwargs:
                    input_str = kwargs["input"]
                elif "query" in kwargs:
                    input_str = kwargs["query"]
                elif "text" in kwargs:
                    input_str = kwargs["text"]
                elif "content" in kwargs:
                    input_str = kwargs["content"]
                elif len(kwargs) > 0:
                    # Try to use the first kwargs value
                    input_str = next(iter(kwargs.values()))
                else:
                    # Fallback to empty string if no input is provided
                    input_str = "{}"
            
            # If input_str is already a dict, convert it to JSON string
            if isinstance(input_str, (dict, list)):
                try:
                    import json
                    input_str = json.dumps(input_str)
                except Exception:
                    input_str = str(input_str)
            
            # Get the result
            result = self.function(input_str)
            
            # Use the common utility to ensure consistent string output
            return ensure_string_output(result)
        
        # Add result_as_answer method for newer CrewAI versions
        def result_as_answer(self, result):
            """Format result as a user-friendly answer"""
            try:
                import json
                if isinstance(result, (dict, list)):
                    return json.dumps(result, indent=2)
                return str(result)
            except Exception:
                return str(result)
        
        # Add run method for LangChain compatibility
        def run(self, input_str=None, **kwargs):
            """For LangChain compatibility"""
            # Get result using invoke and ensure it's a string if needed
            result = self.invoke(input_str, **kwargs)
            return ensure_string_output(result)
            
        def __dict__(self):
            return {}
    
    # Extended base classes as fallbacks
    class ExtendedAgent(Agent):
        """Fallback Extended Agent class"""
        def __init__(self, role, goal, backstory, **kwargs):
            # Extract name related fields
            name = kwargs.get("name") or kwargs.get("character_name") or role
            
            # Don't pass name through to avoid compatibility issues
            filtered_kwargs = {k: v for k, v in kwargs.items() if k not in ['name', 'character_name']}
            super().__init__(role=role, goal=goal, backstory=backstory, **filtered_kwargs)
            
            # Store properties directly in __dict__ to avoid attribute errors
            agent_dict = self.__dict__
            agent_dict['_name'] = name  # Store name internally
            agent_dict['tone'] = kwargs.get("tone", "Professional")
            agent_dict['learning_style'] = kwargs.get("learning_style", "Analytical")
            agent_dict['working_style'] = kwargs.get("working_style", "Methodical")
            agent_dict['communication_style'] = kwargs.get("communication_style", "Clear and concise")
            agent_dict['quirks'] = kwargs.get("quirks", [])
            
            # Handle metadata
            metadata = kwargs.get("metadata", {})
            if not isinstance(metadata, dict):
                metadata = {}
            metadata['name'] = name
            metadata['character_name'] = name
            agent_dict['metadata'] = metadata
        
        @property
        def name(self):
            """Safe property to get name from various places"""
            if hasattr(self, '_name') and self._name:
                return self._name
            if hasattr(self, 'metadata') and isinstance(self.metadata, dict):
                if 'name' in self.metadata:
                    return self.metadata['name']
                if 'character_name' in self.metadata:
                    return self.metadata['character_name']
            return self.role
            
        def to_dict(self):
            return {
                "role": self.role,
                "goal": self.goal,
                "backstory": self.backstory,
                "name": self.name,  # Use the safe name property
                "character_name": self.name,  # Include both for compatibility
                "metadata": getattr(self, 'metadata', {})
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
            
        def result_as_answer(self, result):
            """Format result as a user-friendly answer"""
            try:
                import json
                if isinstance(result, (dict, list)):
                    return json.dumps(result, indent=2)
                return str(result)
            except Exception:
                return str(result)
                
        def invoke(self, input_str=None, **kwargs):
            """Required for compatibility with newer CrewAI versions"""
            return f"Tool {self.name} invoked, but CrewAI is not properly installed."
            
        def run(self, input_str=None, **kwargs):
            """For LangChain compatibility"""
            return f"Tool {self.name} run, but CrewAI is not properly installed."
            
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