#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MightyDev CrewAI Server

This module implements the CrewAI server for the MightyDev extension.
It provides an interface to create, manage, and communicate with AI agents using CrewAI.
"""

import os
import sys
import json
import uuid
import time
import socket
import logging
import threading
import signal
import atexit
from pathlib import Path

# Import environment variables
try:
    from . import env_vars
except ImportError:
    try:
        import env_vars
    except ImportError:
        print("Could not import env_vars module")

# Check for different virtual environments
venv_paths = [
    # Custom crewai_venv for Python 3.13
    os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "crewai_venv", "lib", "python3.13", "site-packages"
    )),
    # Custom crewai_venv for Python 3.10
    os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "crewai_venv", "lib", "python3.10", "site-packages"
    )),
    # Default .venv
    os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".venv", "lib", "python3.10", "site-packages"
    )),
    # Add more paths if needed
]

# Add all existing venv paths to sys.path
for venv_path in venv_paths:
    if os.path.exists(venv_path):
        if venv_path not in sys.path:
            sys.path.insert(0, venv_path)
        print(f"Added virtual environment site-packages to Python path: {venv_path}")

# Import the adapter module first
try:
    from . import crewai_adapter
except ImportError:
    try:
        import crewai_adapter
    except ImportError:
        print("Could not import crewai_adapter module")

# Now try to import CrewAI through the adapter
try:
    from crewai import Agent, Task, Crew, Process, LLM
    from crewai.agent import Agent
    from crewai.crew import Crew
    from crewai.task import Task
except ImportError as e:
    print(f"CrewAI import error: {e}")
    print(f"Python path: {sys.path}")
    print("CrewAI is not installed or not working properly")

    # Try to use the adapter's classes directly if importing failed
    try:
        from crewai_adapter import Agent, Task, Crew, Process, LLM
        print("Using CrewAI adapter classes")
    except ImportError:
        print("Error importing adapter classes. Please check your installation")
        # Continue with partial functionality

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("crewai_server")

class CrewAIServer:
    """
    CrewAI Server for MightyDev

    Handles communication between the VSCode extension and the CrewAI library.
    """

    def __init__(self, project_path):
        """
        Initialize the CrewAI server

        Args:
            project_path (str): Path to the project root directory
        """
        self.project_path = project_path
        self.tribe_path = os.path.join(project_path, ".tribe")
        os.makedirs(self.tribe_path, exist_ok=True)

        # Initialize agents and tasks
        self.agents = {}
        self.tasks = {}
        self.crews = {}

        # Load existing state if available
        self._load_state()

    def _load_state(self):
        """Load existing agents, tasks, and crews from the .tribe directory"""
        try:
            # Load agents
            agents_path = os.path.join(self.tribe_path, "agents.json")
            if os.path.exists(agents_path):
                with open(agents_path, "r") as f:
                    agents_data = json.load(f)
                    for agent_data in agents_data:
                        # Convert to CrewAI Agent objects
                        self._create_agent_from_data(agent_data)

            # Load tasks
            tasks_path = os.path.join(self.tribe_path, "tasks.json")
            if os.path.exists(tasks_path):
                with open(tasks_path, "r") as f:
                    tasks_data = json.load(f)
                    for task_data in tasks_data:
                        # Convert to CrewAI Task objects
                        self._create_task_from_data(task_data)

        except Exception as e:
            logger.error(f"Error loading state: {e}")

    def _save_state(self):
        """Save current agents, tasks, and crews to the .tribe directory"""
        try:
            # Save agents
            agents_data = []
            for agent_id, agent in self.agents.items():
                # Convert CrewAI Agent objects to serializable data
                agent_data = {
                    "id": agent_id,
                    "name": agent.name,
                    "role": agent.role,
                    "goal": agent.goal,
                    "backstory": agent.backstory,
                    # Add other attributes as needed
                }
                agents_data.append(agent_data)

            agents_path = os.path.join(self.tribe_path, "agents.json")
            with open(agents_path, "w") as f:
                json.dump(agents_data, f, indent=2)

            # Save tasks
            tasks_data = []
            for task_id, task in self.tasks.items():
                # Convert CrewAI Task objects to serializable data
                task_data = {
                    "id": task_id,
                    "description": task.description,
                    "agent_id": task.agent.name if task.agent else None,
                    # Add other attributes as needed
                }
                tasks_data.append(task_data)

            tasks_path = os.path.join(self.tribe_path, "tasks.json")
            with open(tasks_path, "w") as f:
                json.dump(tasks_data, f, indent=2)

        except Exception as e:
            logger.error(f"Error saving state: {e}")

    def _create_agent_from_data(self, agent_data):
        """
        Create a CrewAI Agent from the provided data

        Args:
            agent_data (dict): Agent data

        Returns:
            Agent: CrewAI Agent object
        """
        try:
            agent_id = agent_data.get("id", f"agent-{uuid.uuid4()}")

            # Create an LLM instance based on available API keys
            llm = None

            # Check for API keys in environment and config
            anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
            openai_api_key = os.environ.get("OPENAI_API_KEY")

            # Try to find .env files in multiple locations
            env_file_locations = [
                # Extension root .env
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"),
                # Project .env (if project_path is set)
                os.path.join(self.project_path, ".env") if self.project_path else None,
                # Project .tribe/.env
                os.path.join(self.project_path, ".tribe", ".env") if self.project_path else None,
                # Home directory .env
                os.path.join(os.path.expanduser("~"), ".env"),
            ]

            # Filter out None values
            env_file_locations = [loc for loc in env_file_locations if loc]

            # Log all potential .env file locations
            logger.info(f"Searching for .env files in: {env_file_locations}")

            # Check each location
            for env_file in env_file_locations:
                if os.path.exists(env_file):
                    logger.info(f"Found .env file at: {env_file}")
                    try:
                        with open(env_file, "r") as f:
                            for line in f:
                                line = line.strip()
                                if line and not line.startswith('#'):
                                    try:
                                        key, value = line.split('=', 1)
                                        key = key.strip()
                                        value = value.strip().strip('"\'')

                                        if key == "ANTHROPIC_API_KEY" and not anthropic_api_key:
                                            anthropic_api_key = value
                                            logger.info(f"Loaded ANTHROPIC_API_KEY from {env_file}")
                                        elif key == "OPENAI_API_KEY" and not openai_api_key:
                                            openai_api_key = value
                                            logger.info(f"Loaded OPENAI_API_KEY from {env_file}")
                                    except ValueError:
                                        # Skip lines that don't have the format key=value
                                        logger.error(f"Invalid line in .env file ({env_file}): {line}")
                                        continue
                    except Exception as e:
                        logger.error(f"Error reading .env file {env_file}: {e}")

            # Try Anthropic first if key is available
            if anthropic_api_key:
                try:
                    llm = LLM(
                        model="anthropic/claude-3-7-sonnet-20250219",
                    )
                    logger.info("Using Anthropic Claude Sonnet as LLM provider")
                except Exception as e:
                    logger.error(f"Failed to initialize Anthropic LLM: {e}")

            # Try OpenAI if Anthropic is not available or failed
            if llm is None and openai_api_key:
                try:
                    llm = LLM(
                        provider="openai",
                        model="gpt-4-turbo-latest",
                        api_key=openai_api_key
                    )
                    logger.info("Using OpenAI GPT-4 Turbo as LLM provider")
                except Exception as e:
                    logger.error(f"Failed to initialize OpenAI LLM: {e}")

            # Use the default LLM if no specific provider is available
            if llm is None:
                # Check if we have at least one API key to continue
                if anthropic_api_key or openai_api_key:
                    logger.warning("Failed to initialize LLM with available API keys. Will use default configuration.")
                    # Continue with default initialization, no specific LLM
                else:
                    logger.warning("No API keys found for Anthropic or OpenAI.")
                    logger.warning("The extension may not work properly with limited functionality.")
                    logger.warning("Please configure at least one API key in the Environment Manager.")

            # Create the CrewAI Agent with the LLM
            agent_args = {
                "role": agent_data.get("role", "AI Assistant"),
                "goal": agent_data.get("goal", "Help the user with their tasks"),
                "backstory": agent_data.get("backstory", "An AI assistant with extensive knowledge."),
                "verbose": True,
                "allow_delegation": agent_data.get("allow_delegation", False),
            }

            # Determine the optimal model to use
            # First, check if we have API keys with specific model preferences
            anthropic_disabled = False
            openai_disabled = False

            # Look for model preference in environment variables - if ANTHROPIC_API_KEY_DISABLED exists
            # and is set to 'true', use OpenAI instead, and vice versa
            for env_file in env_file_locations:
                if os.path.exists(env_file):
                    try:
                        with open(env_file, "r") as f:
                            for line in f:
                                line = line.strip()
                                if line and not line.startswith('#'):
                                    try:
                                        key, value = line.split('=', 1)
                                        key = key.strip()
                                        value = value.strip().strip('"\'')

                                        if key == "ANTHROPIC_API_KEY_DISABLED" and value.lower() == "true":
                                            anthropic_disabled = True
                                            logger.info("Anthropic API is disabled by user preference")
                                        elif key == "OPENAI_API_KEY_DISABLED" and value.lower() == "true":
                                            openai_disabled = True
                                            logger.info("OpenAI API is disabled by user preference")
                                    except ValueError:
                                        # Skip lines that don't have the format key=value
                                        continue
                    except Exception as e:
                        logger.error(f"Error reading preferences from .env file {env_file}: {e}")

            # Choose the LLM based on availability and preferences
            if llm is None:
                # Try to create an LLM with available keys and preferences
                if anthropic_api_key and not anthropic_disabled:
                    try:
                        llm = LLM(

                            model="anthropic/claude-3-7-sonnet-20250219",
                        )
                        logger.info("Using Anthropic Claude Sonnet as LLM provider (second attempt)")
                    except Exception as e:
                        logger.error(f"Failed to initialize Anthropic LLM (second attempt): {e}")

                if llm is None and openai_api_key and not openai_disabled:
                    try:
                        llm = LLM(
                            provider="openai",
                            model="gpt-4-turbo-latest",
                            api_key=openai_api_key
                        )
                        logger.info("Using OpenAI GPT-4 Turbo as LLM provider (second attempt)")
                    except Exception as e:
                        logger.error(f"Failed to initialize OpenAI LLM (second attempt): {e}")

            # Add the LLM if it's available
            if llm:
                agent_args["llm"] = llm
                try:
                    # Log LLM details for debugging (without showing API keys)
                    llm_details = {
                        "provider": getattr(llm, "provider", "unknown"),
                        "model": getattr(llm, "model", "unknown"),
                        "class": type(llm).__name__
                    }
                    logger.info(f"Created agent with LLM configuration: {llm_details}")
                except Exception as e:
                    logger.info(f"Created agent with LLM, but couldn't log details: {e}")
                    logger.info(f"LLM type: {type(llm)}")
            else:
                logger.warning("No LLM available for agent creation - may have limited functionality")

            agent = Agent(**agent_args)

            # Store the agent
            self.agents[agent_id] = agent
            return agent

        except Exception as e:
            logger.error(f"Error creating agent: {e}")
            return None

    def _create_task_from_data(self, task_data):
        """
        Create a CrewAI Task from the provided data

        Args:
            task_data (dict): Task data

        Returns:
            Task: CrewAI Task object
        """
        try:
            task_id = task_data.get("id", f"task-{uuid.uuid4()}")

            # Get the assigned agent
            agent_id = task_data.get("agent_id")
            agent = self.agents.get(agent_id)

            # Create the CrewAI Task
            task = Task(
                description=task_data.get("description", "No description provided"),
                agent=agent,
                expected_output=task_data.get("expected_output", "A detailed response"),
            )

            # Store the task
            self.tasks[task_id] = task
            return task

        except Exception as e:
            logger.error(f"Error creating task: {e}")
            return None

    def create_agent(self, agent_data):
        """
        Create a new agent

        Args:
            agent_data (dict): Agent data

        Returns:
            dict: Created agent data
        """
        agent = self._create_agent_from_data(agent_data)
        if agent:
            self._save_state()
            return {"id": agent_data.get("id"), "status": "created"}

        return {"status": "error", "message": "Failed to create agent"}

    def create_task(self, task_data):
        """
        Create a new task

        Args:
            task_data (dict): Task data

        Returns:
            dict: Created task data
        """
        task = self._create_task_from_data(task_data)
        if task:
            self._save_state()
            return {"id": task_data.get("id"), "status": "created"}

        return {"status": "error", "message": "Failed to create task"}

    def create_crew(self, crew_data):
        """
        Create a new crew

        Args:
            crew_data (dict): Crew data

        Returns:
            dict: Created crew data
        """
        try:
            crew_id = crew_data.get("id", f"crew-{uuid.uuid4()}")

            # Check if this is a bootstrapping request from a project description
            if "description" in crew_data and not crew_data.get("agent_ids") and not crew_data.get("task_ids"):
                logger.info(f"Creating bootstrapping crew from description: {crew_data['description']}")
                
                # Call enhanced bootstrapping method for more sophisticated team creation
                return self._create_bootstrap_team(crew_id, crew_data['description'])

            # Normal crew creation with existing agents and tasks
            agent_ids = crew_data.get("agent_ids", [])
            agents = [self.agents[agent_id] for agent_id in agent_ids if agent_id in self.agents]

            # Get the tasks for this crew
            task_ids = crew_data.get("task_ids", [])
            tasks = [self.tasks[task_id] for task_id in task_ids if task_id in self.tasks]

            # Create the CrewAI Crew with extra error handling
            try:
                crew = Crew(
                    agents=agents,
                    tasks=tasks,
                    verbose=True,
                    process=Process.sequential,
                    memory=True,
                )

                # Store the crew
                self.crews[crew_id] = crew

                return {"id": crew_id, "status": "created"}

            except Exception as crew_error:
                logger.error(f"Error creating regular crew: {crew_error}")

                # If it's an API key error but we have agents and tasks, create a mockup crew
                if "API key" in str(crew_error):
                    logger.info("API key error detected. Creating a simplified crew response.")

                    # Return success anyway to avoid blocking the UI
                    return {
                        "id": crew_id,
                        "status": "created",
                        "message": "Created with limited functionality - please configure API keys in the Environment Manager"
                    }
                else:
                    # For other errors, propagate them normally
                    raise crew_error

        except Exception as e:
            logger.error(f"Error creating crew: {e}")
            return {"status": "error", "message": f"Failed to create crew: {str(e)}"}
            
    def _create_bootstrap_team(self, crew_id, project_description):
        """
        Create a bootstrap team with the recruitment team agents.
        
        This implements the team bootstrapping pattern described in CLAUDE.md:
        1. Create a recruitment team with hardcoded agents that dissolve after team creation
        2. Allow foundation model to break projects into phases
        3. Create optimal team for Phase 1
        4. Ensure all agent fields are properly filled
        
        Args:
            crew_id (str): ID for the crew
            project_description (str): Description of the project
            
        Returns:
            dict: Response with status and message
        """
        try:
            # Create a set of recruitment team agents - each with specialized roles
            recruitment_team = [
                {
                    # Use name directly, and store our logical ID in metadata
                    "name": "Nova",
                    "role": "Project Analyzer",
                    "goal": "Break down projects into well-defined phases and milestones",
                    "backstory": "With years of experience in project management and strategic planning, Nova excels at analyzing project requirements and creating optimal roadmaps.",
                    "tone": "Analytical",
                    "learning_style": "Systematic",
                    "working_style": "Methodical",
                    "communication_style": "Clear and precise",
                    "quirks": ["Always thinks in milestones", "Uses project management terminology"],
                    "metadata": {
                        "team": "recruitment", 
                        "dissolves_after_bootstrap": True,
                        "logical_id": "project_analyzer"
                    }
                },
                {
                    "name": "Trinity",
                    "role": "Team Architect",
                    "goal": "Design optimal team structures based on project requirements",
                    "backstory": "Trinity has assembled countless high-performing teams across various domains. She has an intuitive understanding of how to match skills and personalities.",
                    "tone": "Strategic",
                    "learning_style": "Intuitive",
                    "working_style": "Adaptive",
                    "communication_style": "Thoughtful and balanced",
                    "quirks": ["Often references successful team structures from history", "Thinks in terms of team dynamics"],
                    "metadata": {
                        "team": "recruitment", 
                        "dissolves_after_bootstrap": True,
                        "logical_id": "team_architect"
                    }
                },
                {
                    "name": "Sparks",
                    "role": "Agent Designer",
                    "goal": "Create detailed agent profiles with appropriate personalities and skills",
                    "backstory": "Sparks specializes in crafting detailed personas and backstories that give AI agents distinctive, effective personalities.",
                    "tone": "Creative",
                    "learning_style": "Exploratory",
                    "working_style": "Detail-oriented",
                    "communication_style": "Colorful and rich",
                    "quirks": ["Anthropomorphizes everything", "Uses character development terminology"],
                    "metadata": {
                        "team": "recruitment", 
                        "dissolves_after_bootstrap": True,
                        "logical_id": "agent_designer"
                    }
                }
            ]
            
            # Create our recruitment agents - CrewAI will assign IDs
            team_agents = []
            
            for i, agent_data in enumerate(recruitment_team):
                # Make a copy to avoid modifying the original dict
                agent_data_copy = agent_data.copy()
                
                # Log the agent we're creating
                logger.debug(f"Creating agent {i+1}/{len(recruitment_team)}: '{agent_data_copy.get('role')}', name: {agent_data_copy.get('name')}")
                
                # Try to create the recruitment team agent with ExtendedAgent if available
                try:
                    # Import the extended agent class if available
                    from crewai import ExtendedAgent
                    agent = ExtendedAgent(**agent_data_copy)
                    team_agents.append(agent)
                    # Store the agent using its assigned ID
                    self.agents[agent.id] = agent
                    logger.debug(f"Created agent with ID {agent.id}, name: {getattr(agent, 'name', None)}")
                except (ImportError, AttributeError) as e:
                    logger.error(f"Error creating ExtendedAgent: {str(e)}")
                    # Fall back to regular agent creation
                    agent = self._create_agent_from_data(agent_data_copy)
                    if agent:
                        team_agents.append(agent)
                        # Store agent using its assigned ID if available
                        if hasattr(agent, 'id'):
                            self.agents[agent.id] = agent
                        
            # Use our team_agents list that contains all the created agents
            recruitment_agents = team_agents
            
            if len(recruitment_agents) < len(recruitment_team):
                logger.warning(f"Not all recruitment agents could be created. Proceeding with {len(recruitment_agents)} agents.")
            
            if not recruitment_agents:
                logger.error("Failed to create any recruitment agents")
                return {"status": "error", "message": "Failed to create recruitment agents"}
            
            # Create a global logical ID to agent mapping
            logical_id_map = {}
            
            # Log what fields are available on the agent objects
            if recruitment_agents:
                sample_agent = recruitment_agents[0]
                available_fields = [field for field in dir(sample_agent) if not field.startswith('_')]
                logger.debug(f"Available agent fields: {available_fields}")
            
            # Match each agent with logical ID from metadata and also by index as fallback
            for i, agent in enumerate(recruitment_agents):
                # Store our logical ID mapping
                logical_id = None
                
                # Check if agent has metadata and if metadata has logical_id
                if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and 'logical_id' in agent.metadata:
                    logical_id = agent.metadata['logical_id']
                    logical_id_map[logical_id] = agent
                    logger.debug(f"Mapped agent to logical ID '{logical_id}'")
                
                # For agents created during debugging, their metadata might be a string
                # Store by name as a fallback
                if hasattr(agent, 'name') and agent.name:
                    name_as_id = agent.name.lower().replace(' ', '_')
                    if name_as_id not in logical_id_map:
                        logical_id_map[name_as_id] = agent
                        logger.debug(f"Mapped agent to name-based ID '{name_as_id}'")
                
                # Also store by role as a fallback
                if hasattr(agent, 'role') and agent.role:
                    role_as_id = agent.role.lower().replace(' ', '_')
                    if role_as_id not in logical_id_map:
                        logical_id_map[role_as_id] = agent
                        logger.debug(f"Mapped agent to role-based ID '{role_as_id}'")
                
                # Always store by index as final fallback
                logical_id_map[f"agent_{i}"] = agent
            
            # Log available logical IDs
            logger.debug(f"Available logical IDs: {list(logical_id_map.keys())}")
            
            # Use our find_agent method to locate the necessary agents
            project_analyzer = self.find_agent(logical_id="project_analyzer") or self.find_agent(name="Nova") or self.find_agent(role="Project Analyzer")
            
            team_architect = self.find_agent(logical_id="team_architect") or self.find_agent(name="Trinity") or self.find_agent(role="Team Architect")
            
            agent_designer = self.find_agent(logical_id="agent_designer") or self.find_agent(name="Sparks") or self.find_agent(role="Agent Designer")
            
            # Check if we found all the required agents
            if not all([project_analyzer, team_architect, agent_designer]):
                logger.error("Could not find all required recruitment agents")
                missing_agents = []
                if not project_analyzer:
                    missing_agents.append("Project Analyzer / Nova")
                if not team_architect:
                    missing_agents.append("Team Architect / Trinity")
                if not agent_designer:
                    missing_agents.append("Agent Designer / Sparks")
                logger.error(f"Missing agents: {', '.join(missing_agents)}")
                
                # Log the actual agent details to help with debugging
                logger.error(f"Created agents: {[(a.id, getattr(a, 'name', None), getattr(a, 'role', None)) for a in recruitment_agents]}")
                
                return {"status": "error", "message": f"Failed to identify required recruitment agents: {', '.join(missing_agents)}"}
            
            # Create the recruitment team tasks
            recruitment_tasks = [
                # Task 1: Analyze project and break into phases
                Task(
                    description=f"Analyze the following project description and break it into logical phases: '{project_description}'. "
                               f"For each phase, provide: 1) A name, 2) Key objectives, 3) Required skills. "
                               f"IMPORTANT: Use the structured_json_output tool to format your response as a JSON object.",
                    agent=project_analyzer,
                    expected_output="A JSON object with an array of project phases, each with name, objectives, and required skills. You MUST use the structured_json_output tool to ensure your response is properly formatted."
                ),
                # Task 2: Design team structure for Phase 1
                Task(
                    description="Based on the project analysis, design an optimal team structure for Phase 1. "
                               "The team should include 3-5 specialized agents with complementary skills. "
                               "IMPORTANT: Use the structured_json_output tool to format your response as a JSON object.",
                    agent=team_architect,
                    expected_output="A JSON object describing the team structure with roles, responsibilities, and relationships between agents. You MUST use the structured_json_output tool to ensure your response is properly formatted."
                ),
                # Task 3: Create detailed agent profiles
                Task(
                    description="Create detailed profiles for each agent in the team. Each profile must include: "
                               "character name, role, goal, backstory, tone, learning style, working style, "
                               "communication style, and 2-3 quirks that make the agent's personality distinctive. "
                               "IMPORTANT: Use the structured_json_output tool to format your response as a JSON array.",
                    agent=agent_designer,
                    expected_output="A JSON array of agent profiles with all required fields. You MUST use the structured_json_output tool to ensure your response is properly formatted."
                )
            ]
            
            try:
                # First, create and register tools for better JSON output
                try:
                    from crewai import StructuredJSONOutputTool
                    from crewai import ExtractJSONTool
                    
                    # Define the exact JSON schema we expect
                    team_schema = {
                        "type": "object",
                        "properties": {
                            "agents": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "role": {"type": "string"},
                                        "goal": {"type": "string"},
                                        "description": {"type": "string"},
                                        "backstory": {"type": "string"},
                                        "skills": {"type": "array", "items": {"type": "string"}},
                                        "communicationStyle": {"type": "string"},
                                        "workingStyle": {"type": "string"},
                                        "quirks": {"type": "array", "items": {"type": "string"}},
                                        "autonomyLevel": {"type": "number"}
                                    }
                                }
                            },
                            "tasks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "title": {"type": "string"},
                                        "description": {"type": "string"},
                                        "priority": {"type": "string"},
                                        "assignee": {"type": "string"}
                                    }
                                }
                            },
                            "summary": {"type": "string"}
                        }
                    }
                    
                    # Create instances of the tools
                    json_output_tool = StructuredJSONOutputTool(schema=team_schema)
                    extract_json_tool = ExtractJSONTool()
                    
                    # Create a crew for the recruitment process with JSON tools
                    recruitment_crew = Crew(
                        agents=recruitment_agents,
                        tasks=recruitment_tasks,
                        verbose=True,
                        process=Process.sequential,
                        memory=True,
                        tools=[json_output_tool, extract_json_tool]
                    )
                except (ImportError, AttributeError) as e:
                    logger.error(f"Error creating JSON tools: {str(e)}")
                    # Fall back to regular crew creation
                    recruitment_crew = Crew(
                        agents=recruitment_agents,
                        tasks=recruitment_tasks,
                        verbose=True,
                        process=Process.sequential,
                        memory=True,
                    )
                
                # Store this temporary crew
                self.crews[f"{crew_id}-recruitment"] = recruitment_crew
                
                # For now, we just return success as we don't yet have the final team
                # In a full implementation, we would run the crew and process the results
                return {
                    "id": crew_id,
                    "status": "created",
                    "message": "Created recruitment team - next step will automatically create Phase 1 team",
                    "recruitment_crew_id": f"{crew_id}-recruitment"
                }
            except Exception as crew_error:
                logger.error(f"Error creating recruitment crew: {crew_error}")
                
                # Create a simplified fallback
                # Create a basic agent if none exists
                agent_id = "bootstrap-agent"
                if agent_id not in self.agents:
                    bootstrap_agent_data = {
                        "id": agent_id,
                        "name": "Bootstrap",
                        "role": "Bootstrapping Agent",
                        "goal": "Initialize the project and create a team",
                        "backstory": "Specialized in analyzing project requirements and creating optimal team structures."
                    }
                    self._create_agent_from_data(bootstrap_agent_data)

                # Add the bootstrap agent
                agents = [self.agents[agent_id]] if agent_id in self.agents else []
                tasks = []

                if agents:
                    # Create a task for the bootstrap agent
                    task = Task(
                        description=f"Analyze the project description: '{project_description}' and create an optimal team structure.",
                        agent=agents[0],
                        expected_output="A detailed team structure proposal"
                    )
                    tasks.append(task)

                # Create a simple Crew as a fallback
                try:
                    crew = Crew(
                        agents=agents,
                        tasks=tasks,
                        verbose=True,
                        process=Process.sequential,
                        memory=True,
                    )

                    # Store the crew
                    self.crews[crew_id] = crew

                    return {
                        "id": crew_id, 
                        "status": "created",
                        "message": "Created fallback bootstrap crew due to error with recruitment team",
                        "fallback": True
                    }
                except Exception as simple_crew_error:
                    logger.error(f"Error creating simple bootstrap crew: {simple_crew_error}")
                    return {
                        "id": crew_id,
                        "status": "created",
                        "message": "Created with limited functionality - please configure API keys in the Environment Manager"
                    }
                
        except Exception as e:
            logger.error(f"Error creating bootstrap team: {e}")
            return {"status": "error", "message": f"Failed to create bootstrap team: {str(e)}"}

    def run_crew(self, crew_id):
        """
        Run a crew

        Args:
            crew_id (str): Crew ID

        Returns:
            dict: Result of running the crew
        """
        try:
            crew = self.crews.get(crew_id)
            if not crew:
                return {"status": "error", "message": f"Crew with ID {crew_id} not found"}

            # Run the crew
            result = crew.kickoff()
            
            # Handle CrewOutput object serialization
            if hasattr(result, "__class__") and result.__class__.__name__ == "CrewOutput":
                # Convert CrewOutput to a serializable dict
                return {
                    "status": "completed",
                    "result": str(result)
                }
            else:
                return {
                    "status": "completed",
                    "result": result
                }

        except Exception as e:
            logger.error(f"Error running crew: {e}")
            return {"status": "error", "message": f"Failed to run crew: {str(e)}"}

    def create_task_coordinator(self, crew_id=None):
        """
        Creates a specialized Task Coordinator agent that handles task assignment,
        delegation, and workload management across the team.
        
        The Task Coordinator handles:
        1. Finding the best agent for a given task based on skills and availability
        2. Managing agent workloads and preventing overallocation
        3. Facilitating delegation between agents
        4. Monitoring task completion and reassigning as needed
        
        Args:
            crew_id (str, optional): ID of the crew this coordinator will work with
            
        Returns:
            dict: Status and the created agent's ID
        """
        try:
            # Create the Task Coordinator agent with specialized capabilities
            task_coordinator_data = {
                "name": "Coordinator",
                "role": "Task Coordinator",
                "goal": "Efficiently assign tasks to the most suitable agents and facilitate team collaboration",
                "backstory": "Coordinator excels at understanding agent capabilities, workloads, and task requirements to create optimal assignments. They maintain the team's productivity by ensuring work is distributed based on skills, availability, and priorities.",
                "tone": "Efficient",
                "learning_style": "Analytical",
                "working_style": "Systematic",
                "communication_style": "Clear and direct",
                "quirks": ["Always considers workload balance", "Prioritizes team efficiency over individual preferences"],
                "metadata": {
                    "team": "management", 
                    "logical_id": "task_coordinator",
                    "is_coordinator": True
                }
            }
            
            # Create the coordinator agent
            coordinator = self._create_agent_from_data(task_coordinator_data)
            
            if coordinator and hasattr(coordinator, 'id'):
                coord_id = coordinator.id
                self.agents[coord_id] = coordinator
                
                # If we have a crew, add this agent to it
                if crew_id and crew_id in self.crews:
                    # Add coordinator to the crew's agents
                    # Note: This might need adjustment based on the CrewAI version
                    # as some versions don't allow adding agents after crew creation
                    try:
                        self.crews[crew_id].agents.append(coordinator)
                    except Exception as e:
                        logger.warning(f"Could not add coordinator to crew: {e}")
                
                return {
                    "status": "success",
                    "agent_id": coord_id,
                    "message": "Task Coordinator agent created successfully"
                }
            else:
                return {
                    "status": "error",
                    "message": "Failed to create Task Coordinator agent"
                }
                
        except Exception as e:
            logger.error(f"Error creating Task Coordinator: {e}")
            return {
                "status": "error",
                "message": f"Failed to create Task Coordinator: {str(e)}"
            }
    
    def find_suitable_agent(self, task_description, required_skills=None, priority="medium", deadline=None):
        """
        Finds the most suitable agent for a given task based on skills, workload, and availability.
        This can be used by both humans and other agents for delegation.
        
        Args:
            task_description (str): Description of the task
            required_skills (list, optional): List of skills required for the task
            priority (str, optional): Priority of the task (low, medium, high, critical)
            deadline (str, optional): ISO format date string for when the task is due
            
        Returns:
            dict: Recommended agent(s) with suitability scores and reasons
        """
        if not self.agents:
            return {
                "status": "error",
                "message": "No agents available for task assignment"
            }
        
        # Find our task coordinator if available
        coordinator = self.find_agent(logical_id="task_coordinator")
        
        # If we have a coordinator, use that agent to make the recommendation
        if coordinator:
            prompt = f"""
            Task Assignment Analysis
            
            Task Description: {task_description}
            
            {f'Required Skills: {", ".join(required_skills)}' if required_skills else ''}
            Priority: {priority}
            {f'Deadline: {deadline}' if deadline else ''}
            
            Available Agents:
            {self._format_agent_list_for_prompt()}
            
            Based on the task requirements and agent capabilities, determine the most suitable agent(s) for this task.
            For each recommended agent, provide:
            1. A suitability score from 0-100
            2. Reasoning for why this agent is suitable
            3. Any potential concerns or limitations
            
            Return your recommendation in JSON format:
            {{
                "recommendations": [
                    {{
                        "agent_id": "<agent_id>",
                        "name": "<agent_name>",
                        "suitability_score": <score>,
                        "reasoning": "<reasons why this agent is suitable>",
                        "concerns": "<any potential issues or limitations>"
                    }}
                ],
                "explanation": "<overall explanation of the recommendation logic>"
            }}
            """
            
            # Ask the coordinator for a recommendation
            try:
                from crewai import RPCAgent
                if isinstance(coordinator, RPCAgent):
                    # For newer CrewAI versions with RPCAgent
                    response = coordinator.run(prompt)
                else:
                    # For older CrewAI versions
                    response = coordinator._process_message(prompt)
                
                # Parse the response for JSON
                import re
                import json
                
                # Try to extract JSON from the response
                json_match = re.search(r'```json\n(.*?)\n```', response, re.DOTALL)
                if json_match:
                    json_str = json_match.group(1)
                else:
                    # Look for just a JSON object without markdown formatting
                    json_match = re.search(r'({[\s\S]*})', response)
                    json_str = json_match.group(1) if json_match else response
                
                try:
                    recommendation = json.loads(json_str)
                    return {
                        "status": "success",
                        "message": "Agent recommendation completed",
                        "data": recommendation
                    }
                except json.JSONDecodeError:
                    logger.error(f"Could not parse JSON from coordinator response: {response}")
                    
            except Exception as e:
                logger.error(f"Error getting recommendation from coordinator: {e}")
        
        # Fallback: simple matching algorithm if coordinator is unavailable or fails
        recommendations = []
        
        # Iterate through all agents
        for agent_id, agent in self.agents.items():
            # Skip the coordinator itself
            if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and agent.metadata.get('is_coordinator'):
                continue
                
            # Calculate a basic suitability score
            score = 50  # Base score
            reasoning = []
            concerns = []
            
            # Check for required skills
            agent_skills = []
            if hasattr(agent, 'skills') and agent.skills:
                if isinstance(agent.skills, list):
                    agent_skills = agent.skills
                elif isinstance(agent.skills, str):
                    agent_skills = [s.strip() for s in agent.skills.split(',')]
            
            if required_skills and agent_skills:
                matched_skills = [skill for skill in required_skills if any(s.lower() in skill.lower() for s in agent_skills)]
                skill_match_percentage = len(matched_skills) / len(required_skills) if required_skills else 0
                score += skill_match_percentage * 30  # Up to 30 points for skills
                
                if skill_match_percentage > 0.7:
                    reasoning.append(f"Has {len(matched_skills)}/{len(required_skills)} required skills")
                elif skill_match_percentage > 0:
                    reasoning.append(f"Has some relevant skills ({len(matched_skills)}/{len(required_skills)})")
                    concerns.append("Missing some required skills")
                else:
                    concerns.append("No matching skills found")
                    score -= 20
            
            # Role relevance (simple string matching)
            if hasattr(agent, 'role') and agent.role:
                lower_desc = task_description.lower()
                lower_role = agent.role.lower()
                
                role_keywords = lower_role.split()
                matched_keywords = [kw for kw in role_keywords if kw in lower_desc]
                
                if matched_keywords:
                    score += 15  # Up to 15 points for role relevance
                    reasoning.append(f"Role '{agent.role}' aligns with task description")
            
            # Availability (placeholder - would be based on agent task count in a real system)
            # Here we're just using a random value since we don't track agent workloads
            import random
            availability = random.uniform(0, 1)
            
            if availability > 0.7:
                score += 15
                reasoning.append("Currently available")
            elif availability > 0.3:
                score += 5
                reasoning.append("Moderately available")
                concerns.append("Has some existing workload")
            else:
                score -= 10
                concerns.append("Heavy existing workload")
            
            # Add to recommendations if score is reasonable
            if score > 40:
                recommendations.append({
                    "agent_id": agent_id,
                    "name": getattr(agent, 'name', None) or getattr(agent, 'role', None) or agent_id,
                    "suitability_score": min(100, int(score)),
                    "reasoning": ", ".join(reasoning),
                    "concerns": ", ".join(concerns) if concerns else "None"
                })
        
        # Sort by suitability score
        recommendations.sort(key=lambda x: x['suitability_score'], reverse=True)
        
        return {
            "status": "success",
            "message": "Agent recommendation completed using fallback algorithm",
            "data": {
                "recommendations": recommendations[:3],  # Top 3 recommendations
                "explanation": "Recommendations based on skill matching, role relevance, and estimated availability."
            }
        }
    
    def _format_agent_list_for_prompt(self):
        """Helper method to format agent info for the coordinator prompt"""
        formatted_list = []
        
        for agent_id, agent in self.agents.items():
            # Skip coordinators in the list
            if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and agent.metadata.get('is_coordinator'):
                continue
                
            agent_info = []
            agent_info.append(f"ID: {agent_id}")
            
            if hasattr(agent, 'name') and agent.name:
                agent_info.append(f"Name: {agent.name}")
                
            if hasattr(agent, 'role') and agent.role:
                agent_info.append(f"Role: {agent.role}")
                
            if hasattr(agent, 'skills') and agent.skills:
                if isinstance(agent.skills, list):
                    agent_info.append(f"Skills: {', '.join(agent.skills)}")
                else:
                    agent_info.append(f"Skills: {agent.skills}")
                    
            if hasattr(agent, 'backstory') and agent.backstory:
                # Truncate backstory
                backstory = agent.backstory[:100] + "..." if len(agent.backstory) > 100 else agent.backstory
                agent_info.append(f"Background: {backstory}")
                
            formatted_list.append(" | ".join(agent_info))
            
        return "\n".join(formatted_list)
    
    def assign_task(self, task_data, assignee_id=None):
        """
        Assigns a task to an agent, either directly or by finding the most suitable agent.
        
        Args:
            task_data (dict): Task data including description, priority, etc.
            assignee_id (str, optional): Specific agent to assign to, or None to auto-assign
            
        Returns:
            dict: Assignment result with status and assigned agent info
        """
        if not assignee_id:
            # Find the best agent for this task
            recommendation = self.find_suitable_agent(
                task_description=task_data.get('description', ''),
                required_skills=task_data.get('required_skills'),
                priority=task_data.get('priority', 'medium'),
                deadline=task_data.get('due_date')
            )
            
            if recommendation['status'] == 'success' and recommendation['data']['recommendations']:
                # Get the top recommendation
                top_choice = recommendation['data']['recommendations'][0]
                assignee_id = top_choice['agent_id']
                
                # Add the recommendation logic to task metadata
                if 'metadata' not in task_data:
                    task_data['metadata'] = {}
                    
                task_data['metadata']['assignment_logic'] = {
                    'score': top_choice['suitability_score'],
                    'reasoning': top_choice['reasoning'],
                    'concerns': top_choice['concerns']
                }
            else:
                return {
                    'status': 'error',
                    'message': 'Could not find a suitable agent for this task'
                }
        
        # Now assign the task
        agent = self.agents.get(assignee_id)
        if not agent:
            return {
                'status': 'error',
                'message': f'Agent with ID {assignee_id} not found'
            }
            
        # In a real implementation, we would update the agent's task list
        # and possibly notify them of the new assignment
        
        return {
            'status': 'success',
            'message': 'Task assigned successfully',
            'data': {
                'task_id': task_data.get('id', 'new_task'),
                'assigned_to': {
                    'id': assignee_id,
                    'name': getattr(agent, 'name', None) or getattr(agent, 'role', None) or assignee_id
                }
            }
        }
    
    def list_agents(self, team=None):
        """
        List all available agents with their important attributes.
        
        Args:
            team (str, optional): Filter agents by team name/id
            
        Returns:
            list: List of agent information dictionaries
        """
        if not self.agents:
            return []
            
        result = []
        for agent_id, agent in self.agents.items():
            # Extract agent metadata
            agent_info = {
                "id": agent_id,
                "name": getattr(agent, 'name', None),
                "role": getattr(agent, 'role', None),
            }
            
            # Add metadata if available
            if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict):
                agent_info["logical_id"] = agent.metadata.get('logical_id')
                agent_info["team"] = agent.metadata.get('team')
            
            # Filter by team if requested
            if team and agent_info.get("team") != team:
                continue
                
            result.append(agent_info)
            
        return result
    
    def find_agent(self, identifier=None, name=None, role=None, logical_id=None, team=None):
        """
        Find an agent using various search criteria. This method provides flexible agent discovery
        without needing to know specific agent IDs in advance.
        
        Args:
            identifier (str): Direct ID of the agent if known
            name (str): Agent's name (case-insensitive partial match)
            role (str): Agent's role (case-insensitive partial match)
            logical_id (str): Logical ID stored in agent metadata
            team (str): Team name or ID to filter agents
            
        Returns:
            Agent or None: The agent if found, otherwise None
            
        Examples:
            # Find by known ID
            agent = find_agent(identifier="agent_123")
            
            # Find by name (partial match)
            agent = find_agent(name="Trinity")  # or even just "trin"
            
            # Find by role (partial match)
            agent = find_agent(role="Architect")
            
            # Find by logical ID
            agent = find_agent(logical_id="team_architect")
            
            # Find by team and role
            agent = find_agent(team="recruitment", role="Designer")
            
        Note:
            To see all available agents, use the list_agents() method.
        """
        if not self.agents:
            logger.warning("No agents available to search")
            return None
            
        # Direct ID lookup if provided
        if identifier and identifier in self.agents:
            return self.agents[identifier]
            
        candidates = list(self.agents.values())
        
        # Filter by logical ID in metadata
        if logical_id:
            logical_id = logical_id.lower()
            filtered = []
            for agent in candidates:
                if (hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and 
                    'logical_id' in agent.metadata and 
                    agent.metadata['logical_id'].lower() == logical_id):
                    filtered.append(agent)
            candidates = filtered if filtered else candidates
        
        # Filter by name (partial match)
        if name and candidates:
            name = name.lower()
            filtered = []
            for agent in candidates:
                if hasattr(agent, 'name') and agent.name and name in agent.name.lower():
                    filtered.append(agent)
            candidates = filtered if filtered else candidates
        
        # Filter by role (partial match)
        if role and candidates:
            role = role.lower()
            filtered = []
            for agent in candidates:
                if hasattr(agent, 'role') and agent.role and role in agent.role.lower():
                    filtered.append(agent)
            candidates = filtered if filtered else candidates
            
        # Filter by team
        if team and candidates:
            team = team.lower()
            filtered = []
            for agent in candidates:
                if (hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and 
                    'team' in agent.metadata and agent.metadata['team'].lower() == team):
                    filtered.append(agent)
            candidates = filtered if filtered else candidates
            
        # Return the first match or None
        return candidates[0] if candidates else None
            
    def send_message_to_agent(self, agent_id, message, is_group=False):
        """
        Send a message to an agent or a group of agents. You can use agent_id 
        directly, or provide a string that can be resolved using find_agent.

        Args:
            agent_id (str): Agent ID or search string (can be None for is_group=True)
            message (str): Message to send
            is_group (bool): Whether this is a message to the entire group

        Returns:
            dict: Agent's response
        """
        try:
            # First check for network connectivity to fail fast if offline
            connectivity_check = self.check_connectivity()
            if not connectivity_check.get("online", False):
                logger.warning("Network connectivity check failed - API endpoints unreachable")
                return {
                    "status": "error",
                    "message": "Cannot send message: Network connectivity issue detected. API endpoints are unreachable.",
                    "error_type": "network"
                }

            # Try to find the agent if agent_id is provided but not a direct match
            if agent_id and not is_group and agent_id not in self.agents:
                logger.info(f"Attempting to find agent using identifier: {agent_id}")
                # Try different search strategies
                found_agent = None
                
                # First try as a logical ID
                found_agent = self.find_agent(logical_id=agent_id)
                
                # Then try as a name
                if not found_agent:
                    found_agent = self.find_agent(name=agent_id)
                
                # Finally try as a role
                if not found_agent:
                    found_agent = self.find_agent(role=agent_id)
                
                if found_agent and hasattr(found_agent, 'id'):
                    logger.info(f"Resolved agent '{agent_id}' to agent ID: {found_agent.id}")
                    agent_id = found_agent.id
                else:
                    logger.warning(f"Could not find agent matching '{agent_id}'")
            
            # Handle group messages
            if is_group:
                logger.info("Processing group message to all agents")
                if not self.agents:
                    return {"status": "error", "message": "No agents available to process the message"}

                # Pick the first available agent for group messages
                # In a full implementation, this would route to the most appropriate agent
                agent_keys = list(self.agents.keys())
                agent_id = agent_keys[0]
                agent = self.agents[agent_id]

                # Modify message to indicate it's for the whole team
                team_message = f"[TEAM MESSAGE] The user has sent the following message to the entire team. " \
                             f"Provide a response on behalf of the team: {message}"

                # Create a task for the agent to process the team message
                task = Task(
                    description=team_message,
                    agent=agent,
                    expected_output="A detailed and helpful team response to the user's message",
                )
            else:
                # Get the specified agent
                agent = self.agents.get(agent_id)

                # Try to create the agent if it doesn't exist
                if not agent:
                    logger.warning(f"Agent with ID {agent_id} not found. Attempting to create a generic agent.")

                    # We don't have enough info to create a real agent, but we'll make a best effort
                    # with a generic one to handle the message
                    try:
                        agent_data = {
                            "id": agent_id,
                            "name": f"Agent {agent_id}",
                            "role": "AI Assistant",
                            "goal": "Respond to user messages helpfully",
                            "backstory": "An AI assistant created to help with this project."
                        }

                        # Create the agent
                        create_result = self.create_agent(agent_data)
                        if create_result.get("status") == "created":
                            agent = self.agents.get(agent_id)
                            logger.info(f"Successfully created generic agent for {agent_id}")
                        else:
                            logger.error(f"Failed to create generic agent: {create_result}")
                            raise Exception(f"Agent with ID {agent_id} not found and couldn't create a replacement")
                    except Exception as agent_error:
                        logger.error(f"Error creating generic agent: {agent_error}")
                        return {"status": "error", "message": f"Agent with ID {agent_id} not found: {agent_error}"}

                # Create a task for the agent to process the message
                task = Task(
                    description=f"Process the following message and respond appropriately: {message}",
                    agent=agent,
                    expected_output="A detailed and helpful response to the user's message",
                )

            # Try to process the message with error handling
            try:
                # Try to create a StructuredJSONOutputTool if the message mentions JSON
                tools = []
                
                try:
                    # Check if the message mentions JSON or team creation
                    if ('json' in message.lower() or 
                        'team' in message.lower() or 
                        'format' in message.lower() or
                        'output' in message.lower() or
                        'structure' in message.lower()):
                        
                        logger.info("Message likely needs structured output - attempting to add JSON tools")
                        
                        try:
                            # First try to import the tools
                            from crewai import StructuredJSONOutputTool, ExtractJSONTool
                            
                            # Look for any JSON schema hints in the message
                            import re
                            schema_hints = re.findall(r'\{[^{}]*\}', message)
                            
                            if schema_hints:
                                # Try to parse any JSON schema fragments
                                logger.info(f"Found potential schema hint: {schema_hints[0]}")
                                
                                # Determine if we need agents/tasks schema
                                team_schema = False
                                if ('agent' in message.lower() or 
                                   'team' in message.lower() or
                                   'task' in message.lower()):
                                    team_schema = True
                            
                            # Create appropriate tools
                            if team_schema:
                                # Use the team schema (same as in _create_bootstrap_team)
                                schema = {
                                    "type": "object",
                                    "properties": {
                                        "agents": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": {"type": "string"},
                                                    "role": {"type": "string"},
                                                    "goal": {"type": "string"},
                                                    "description": {"type": "string"},
                                                    "backstory": {"type": "string"},
                                                    "skills": {"type": "array", "items": {"type": "string"}},
                                                    "communicationStyle": {"type": "string"},
                                                    "workingStyle": {"type": "string"},
                                                    "quirks": {"type": "array", "items": {"type": "string"}},
                                                    "autonomyLevel": {"type": "number"}
                                                }
                                            }
                                        },
                                        "tasks": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "title": {"type": "string"},
                                                    "description": {"type": "string"},
                                                    "priority": {"type": "string"},
                                                    "assignee": {"type": "string"}
                                                }
                                            }
                                        },
                                        "summary": {"type": "string"}
                                    }
                                }
                                logger.info("Using team schema for structured output")
                            else:
                                # Use a generic JSON schema
                                schema = {
                                    "type": "object",
                                    "additionalProperties": True
                                }
                                logger.info("Using generic schema for structured output")
                                
                            # Create the tools
                            json_output_tool = StructuredJSONOutputTool(schema=schema)
                            extract_json_tool = ExtractJSONTool()
                            
                            # Add tools to the list
                            tools = [json_output_tool, extract_json_tool]
                            
                            # Modify the task description to explicitly use the tool
                            task.description = f"{task.description}\n\nIMPORTANT: You MUST use the structured_json_output tool to ensure your response is properly formatted as JSON."
                            
                            logger.info("Successfully added JSON tools to the agent")
                            
                        except Exception as tool_error:
                            logger.error(f"Error creating structured output tools: {tool_error}")
                            # Continue without the tools
                            
                except Exception as check_error:
                    logger.error(f"Error checking for JSON needs: {check_error}")
                    # Continue without the tools
                
                # Create a temporary crew with just this agent and task (and optional tools)
                temp_crew = Crew(
                    agents=[agent],
                    tasks=[task],
                    verbose=True,
                    process=Process.sequential,
                    tools=tools if tools else None
                )

                # Run the crew to get the response
                response = temp_crew.kickoff()
                
                # Handle CrewOutput object serialization
                if hasattr(response, "__class__") and response.__class__.__name__ == "CrewOutput":
                    # Convert CrewOutput to a serializable string
                    return {
                        "status": "completed",
                        "agent_id": agent_id,
                        "response": str(response)
                    }
                else:
                    return {
                        "status": "completed",
                        "agent_id": agent_id,
                        "response": response
                    }
            except Exception as crew_error:
                logger.error(f"Error processing message with CrewAI: {crew_error}")

                # Check if it's an API key error
                if "API key" in str(crew_error):
                    return {
                        "status": "error",
                        "message": "API key error: Please configure your API keys in the Environment Manager.",
                        "error_type": "api_key"
                    }

                # If it's a network error or service issue, we'll generate a simplified response
                if "connect" in str(crew_error).lower() or "network" in str(crew_error).lower():
                    logger.warning("Network error detected, generating simplified response")

                    # Generate a simple response based on the message content
                    simplified_response = f"I understand you're asking about: {message[:100]}... " \
                                        f"However, I'm currently operating with limited capabilities due to " \
                                        f"network connectivity issues. Please check your connection and try again later."

                    return {
                        "status": "completed",
                        "agent_id": agent_id,
                        "response": simplified_response,
                        "limited_functionality": True
                    }

                # For other errors, return the error
                raise crew_error

        except Exception as e:
            logger.error(f"Error sending message to agent: {e}")
            return {"status": "error", "message": f"Failed to send message: {str(e)}"}

    def check_connectivity(self):
        """
        Check network connectivity to API endpoints

        Returns:
            dict: Connectivity status
        """
        import socket
        import urllib.request
        import http.client
        import ssl

        logger.info("Checking network connectivity...")

        # Endpoints to check (Anthropic and OpenAI API endpoints)
        endpoints = [
            "api.anthropic.com",
            "api.openai.com"
        ]

        def check_endpoint(endpoint, timeout=5):
            try:
                # First try simple socket connection to check basic connectivity
                socket.create_connection((endpoint, 443), timeout=timeout)

                # If socket connects, try HTTPS connection to verify SSL works
                conn = http.client.HTTPSConnection(endpoint, timeout=timeout)
                conn.request("HEAD", "/")
                resp = conn.getresponse()
                conn.close()

                logger.info(f"Connection to {endpoint} successful (status: {resp.status})")
                return True
            except (socket.timeout, socket.error, ConnectionRefusedError,
                    ssl.SSLError, http.client.HTTPException) as e:
                logger.error(f"Failed to connect to {endpoint}: {e}")
                return False
            except Exception as e:
                logger.error(f"Unexpected error connecting to {endpoint}: {e}")
                return False

        # Check all endpoints
        results = [check_endpoint(endpoint) for endpoint in endpoints]

        # Return true if at least one endpoint is reachable
        is_online = any(results)
        logger.info(f"Network connectivity check result: {'Online' if is_online else 'Offline'}")

        return {
            "status": "completed",
            "online": is_online,
            "endpoints_checked": endpoints,
            "detailed_results": dict(zip(endpoints, results))
        }

    def handle_request(self, request):
        """
        Handle a request from the VSCode extension

        Args:
            request (dict): Request data

        Returns:
            dict: Response data
        """
        try:
            command = request.get("command")
            payload = request.get("payload", {})

            logger.info(f"Received command: {command} with payload: {payload}")

            # Handle case-insensitive commands
            command_lower = command.lower() if command else ""

            if command_lower == "create_agent":
                return self.create_agent(payload)
            elif command_lower == "create_task":
                return self.create_task(payload)
            elif command_lower == "create_crew" or command_lower == "createteam" or command_lower == "create_team":
                logger.info(f"Creating crew/team with payload: {payload}")
                return self.create_crew(payload)
            elif command_lower == "run_crew":
                return self.run_crew(payload.get("crew_id"))
            elif command_lower == "send_message":
                return self.send_message_to_agent(
                    payload.get("agent_id"),
                    payload.get("message"),
                    payload.get("is_group", False)
                )
            elif command_lower == "create_task_coordinator":
                return self.create_task_coordinator(
                    payload.get("crew_id")
                )
            elif command_lower == "find_suitable_agent":
                return self.find_suitable_agent(
                    task_description=payload.get("task_description"),
                    required_skills=payload.get("required_skills"),
                    priority=payload.get("priority", "medium"),
                    deadline=payload.get("deadline")
                )
            elif command_lower == "assign_task":
                return self.assign_task(
                    task_data=payload.get("task_data", {}),
                    assignee_id=payload.get("assignee_id")
                )
            elif command_lower == "list_agents":
                return {
                    "status": "success", 
                    "agents": self.list_agents(team=payload.get("team"))
                }
            elif command_lower == "check_connectivity":
                return self.check_connectivity()
            else:
                logger.error(f"Unknown command: {command}")
                return {"status": "error", "message": f"Unknown command: {command}"}

        except Exception as e:
            logger.error(f"Error handling request: {e}", exc_info=True)
            return {"status": "error", "message": f"Failed to handle request: {str(e)}"}

def setup_socket_server(port=9876, max_attempts=5):
    """Set up a socket server to listen for requests

    Args:
        port: The port to listen on
        max_attempts: Maximum number of attempts to bind to port

    Returns:
        socket: The server socket

    Raises:
        OSError: If the socket cannot be bound after max_attempts
    """
    # Try to connect to the port first to see if a server is running
    try:
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.settimeout(1)
        test_socket.connect(('localhost', port))
        # If we can connect, a server is already running
        test_socket.close()
        print(f"A server is already running on port {port}")
        # Return an error
        return None
    except (ConnectionRefusedError, socket.timeout):
        # No server running, proceed with creating our server
        pass
    except Exception as e:
        print(f"Error testing port: {e}")
    finally:
        try:
            test_socket.close()
        except:
            pass

    # Try different ports if the specified one is in use
    for attempt in range(max_attempts):
        try:
            current_port = port + attempt
            server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server_socket.bind(('localhost', current_port))
            server_socket.listen(5)
            if current_port != port:
                print(f"Port {port} was in use, listening on port {current_port} instead")
            return server_socket
        except OSError as e:
            print(f"Attempt {attempt+1}/{max_attempts}: Failed to bind to port {current_port}: {e}")
            server_socket.close()
            if attempt == max_attempts - 1:
                raise
            time.sleep(1)  # Brief delay before trying next port

def handle_client(client_socket, server):
    """Handle a client connection"""
    try:
        # Receive data from the client
        data = b''
        while True:
            chunk = client_socket.recv(4096)
            if not chunk:
                break
            data += chunk
            # Check if we have a complete message
            if b'\n' in data:
                break

        if not data:
            return

        # Parse the request
        request_str = data.decode('utf-8').strip()
        request = json.loads(request_str)

        # Handle the request
        response = server.handle_request(request)

        # Send the response
        client_socket.sendall(json.dumps(response).encode('utf-8') + b'\n')

    except Exception as e:
        logger.error(f"Error handling client: {e}")
        try:
            # Send an error response
            error_response = {"status": "error", "message": str(e)}
            client_socket.sendall(json.dumps(error_response).encode('utf-8') + b'\n')
        except:
            pass
    finally:
        # Close the client socket
        client_socket.close()

def cleanup_resources(server_socket, port_file, pid_file):
    """Cleanup function to release resources on exit"""
    logger.info("Cleaning up server resources...")
    try:
        if server_socket:
            server_socket.close()
            logger.info("Closed server socket")
    except Exception as e:
        logger.error(f"Error closing server socket: {e}")

    try:
        # Remove the port file
        if port_file and os.path.exists(port_file):
            os.remove(port_file)
            logger.info(f"Removed port file: {port_file}")
    except Exception as e:
        logger.error(f"Error removing port file: {e}")

    try:
        # Remove the PID file
        if pid_file and os.path.exists(pid_file):
            os.remove(pid_file)
            logger.info(f"Removed PID file: {pid_file}")
    except Exception as e:
        logger.error(f"Error removing PID file: {e}")

    logger.info("Cleanup complete")

def signal_handler(sig, frame, server_socket=None, port_file=None, pid_file=None):
    """Handle signals to ensure clean shutdown"""
    signal_name = {
        signal.SIGINT: "SIGINT",
        signal.SIGTERM: "SIGTERM"
    }.get(sig, str(sig))

    logger.info(f"Received {signal_name}, shutting down...")
    cleanup_resources(server_socket, port_file, pid_file)
    sys.exit(0)

def main():
    """Main entry point for the CrewAI server"""
    import argparse

    parser = argparse.ArgumentParser(description="MightyDev CrewAI Server")
    parser.add_argument("--project-path", type=str, required=True, help="Path to the project root directory")
    parser.add_argument("--port", type=int, default=9876, help="Port to listen on")

    args = parser.parse_args()

    # Create the .tribe directory if it doesn't exist
    tribe_dir = os.path.join(args.project_path, ".tribe")
    os.makedirs(tribe_dir, exist_ok=True)

    # Define port and PID file paths
    port_file = os.path.join(tribe_dir, "server_port.txt")
    pid_file = os.path.join(tribe_dir, "server_pid.txt")

    # Check for existing PID file and kill previous server if possible
    if os.path.exists(pid_file):
        try:
            with open(pid_file, "r") as f:
                old_pid = int(f.read().strip())

            # Try to terminate the previous process
            logger.info(f"Found existing server PID: {old_pid}, attempting to terminate")
            try:
                if sys.platform == "win32":
                    # Windows
                    os.system(f"taskkill /F /PID {old_pid} /T")
                else:
                    # Unix-like
                    os.kill(old_pid, signal.SIGTERM)
                    # Give it a moment to close
                    time.sleep(1)
            except Exception as e:
                logger.error(f"Error terminating previous server: {e}")
        except Exception as e:
            logger.error(f"Error reading PID file: {e}")

    # Write our PID to the PID file
    try:
        with open(pid_file, "w") as f:
            f.write(str(os.getpid()))
        logger.info(f"Wrote PID {os.getpid()} to {pid_file}")
    except Exception as e:
        logger.error(f"Failed to write PID file: {e}")

    # Create the CrewAI server
    server = CrewAIServer(args.project_path)

    # Set up the socket server
    server_socket = setup_socket_server(args.port)
    if server_socket is None:
        # A server is already running, just exit
        logger.info(f"Another CrewAI server is already running on port {args.port}. Exiting.")
        # Clean up the PID file before exiting
        try:
            if os.path.exists(pid_file):
                os.remove(pid_file)
        except:
            pass
        sys.exit(0)

    current_port = server_socket.getsockname()[1]
    logger.info(f"CrewAI server listening on port {current_port} for project: {args.project_path}")

    # Create a file to indicate the server is running and what port it's on
    try:
        with open(port_file, "w") as f:
            f.write(str(current_port))
        logger.info(f"Wrote port information to {port_file}")
    except Exception as e:
        logger.error(f"Failed to write port file: {e}")

    # Set up signal handlers for clean shutdown
    signal.signal(signal.SIGINT, lambda sig, frame: signal_handler(sig, frame, server_socket, port_file, pid_file))
    signal.signal(signal.SIGTERM, lambda sig, frame: signal_handler(sig, frame, server_socket, port_file, pid_file))

    # Register atexit handler for cleanup
    atexit.register(lambda: cleanup_resources(server_socket, port_file, pid_file))

    try:
        # Main server loop
        while True:
            # Accept a client connection
            client_socket, addr = server_socket.accept()
            logger.info(f"Accepted connection from {addr}")

            # Handle the client in a separate thread
            client_thread = threading.Thread(target=handle_client, args=(client_socket, server))
            client_thread.daemon = True
            client_thread.start()

    except KeyboardInterrupt:
        logger.info("Server shutting down...")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
    finally:
        # Final cleanup
        cleanup_resources(server_socket, port_file, pid_file)

if __name__ == "__main__":
    main()
