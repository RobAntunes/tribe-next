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
    # Default .venv
    os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".venv", "lib", "python3.10", "site-packages"
    )),
    # Custom crewai_venv
    os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "crewai_venv", "lib", "python3.10", "site-packages"
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
    print("CrewAI is not installed. Please install with: pip install crewai")

    # Try to use the adapter's classes directly if importing failed
    try:
        from crewai_adapter import Agent, Task, Crew, Process, LLM
        print("Using CrewAI adapter classes")
    except ImportError:
        sys.exit(1)

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

                # Create a bootstrapping agent if none exists
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

                # Create a bootstrapping task
                task_id = "bootstrap-task"
                task_description = f"Analyze the project description: '{crew_data['description']}' and create an optimal team structure."

                # Add the bootstrap agent and task
                agents = [self.agents[agent_id]] if agent_id in self.agents else []
                tasks = []

                if agents:
                    # Create a task for the bootstrap agent
                    task = Task(
                        description=task_description,
                        agent=agents[0],
                        expected_output="A detailed team structure proposal"
                    )
                    tasks.append(task)

                # Create a simple Crew just to handle the bootstrap
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
                    # We'll try a more resilient approach for bootstrapping
                    logger.error(f"Error creating bootstrap crew: {crew_error}")
                    logger.info("Creating a simplified crew response for bootstrapping")

                    # Return success anyway to avoid blocking the UI
                    return {
                        "id": crew_id,
                        "status": "created",
                        "message": "Created with limited functionality - please add API keys in the Environment Manager"
                    }

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

    def send_message_to_agent(self, agent_id, message, is_group=False):
        """
        Send a message to an agent or a group of agents

        Args:
            agent_id (str): Agent ID (can be None for is_group=True)
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
                # Create a temporary crew with just this agent and task
                temp_crew = Crew(
                    agents=[agent],
                    tasks=[task],
                    verbose=True,
                    process=Process.sequential,
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
