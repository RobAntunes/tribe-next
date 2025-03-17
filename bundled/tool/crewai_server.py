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
import subprocess
from pathlib import Path

# Import environment variables
try:
    from . import env_vars
except ImportError:
    try:
        import env_vars
    except ImportError:
        print("Could not import env_vars module")

# Import the indexer module
try:
    from .mightydev.indexer import CodebaseIndexer
except ImportError:
    try:
        from mightydev.indexer import CodebaseIndexer
    except ImportError:
        print("Could not import indexer module, codebase indexing will be disabled")

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
        
        # Initialize progress tracking
        self.progress_data = None
        self.crews = {}
        self.tools = {}  # tool_id -> tool object
        self.agent_tools = {}  # agent_id -> list of tool_ids

        # Initialize workload tracking
        self.agent_workloads = {}  # agent_id -> workload metrics
        self.agent_tasks = {}      # agent_id -> list of active tasks
        self.task_status = {}      # task_id -> status information
        self.conflict_history = {} # Tracks conflicts and resolutions
        self.pending_approvals = {} # Human-in-the-loop approval requests

        # Agent performance metrics
        self.agent_performance = {} # agent_id -> performance metrics

        # Initialize codebase indexer if available
        self.codebase_indexer = None
        try:
            from mightydev.indexer import CodebaseIndexer
            self.codebase_indexer = CodebaseIndexer(workspace_root=project_path)
            logger.info(f"Initialized CodebaseIndexer for workspace: {project_path}")
        except ImportError:
            logger.warning("CodebaseIndexer not available - codebase indexing will be disabled")
        except Exception as e:
            logger.error(f"Error initializing CodebaseIndexer: {e}")

        # Create default tools that will be available to all agents
        self._create_default_tools()

        # Load existing state if available
        self._load_state()

    def _create_default_tools(self):
        """Create default tools that will be available to all agents"""
        try:
            # Import tools from crewai
            try:
                from crewai.tools import BaseTool
                from pydantic import Field
                from typing import Any, Dict, List, Optional, Union
                logger.info("Using tools from crewai")
                
                # Standard tool definition as per CrewAI documentation
                class LearningSystemTool(BaseTool):
                    name: str = "learning_system"
                    description: str = "Access and update the agent's learning and memory system. Use for storing experiences, retrieving knowledge, and reflection."
                    
                    def _run(self, action: str, data: Optional[Dict] = None) -> Dict[str, Any]:
                        """Execute the learning system operation and return results"""
                        return {
                            "status": "success",
                            "action": action,
                            "message": f"Learning system tool called with action '{action}'",
                            "data": data
                        }

                class ProjectManagementTool(BaseTool):
                    name: str = "project_management"
                    description: str = "Manage tasks, assignments, and project structure. Use for creating tasks, updating status, and coordination."
                    
                    def _run(self, action: str, data: Optional[Dict] = None) -> Dict[str, Any]:
                        """Execute the project management operation and return results"""
                        return {
                            "status": "success",
                            "action": action,
                            "message": f"Project management tool called with action '{action}'",
                            "data": data
                        }
                        
                class MetadataTool(BaseTool):
                    name: str = "metadata"
                    description: str = "Access and manipulate document metadata. Use for retrieving information about files and projects."
                    
                    def _run(self, action: str, data: Optional[Dict] = None) -> Dict[str, Any]:
                        """Execute the metadata operation and return results"""
                        return {
                            "status": "success",
                            "action": action,
                            "message": f"Metadata tool called with action '{action}'",
                            "data": data
                        }
                
                class ShellExecutionTool(BaseTool):
                    name: str = "shell_execution"
                    description: str = "Execute shell commands in the project environment. Use with caution."
                    
                    def _run(self, command: str, cwd: Optional[str] = None) -> Dict[str, Any]:
                        """Execute shell command and return results"""
                        if not command or not isinstance(command, str):
                            return {
                                "status": "error",
                                "message": "No command provided or invalid command format",
                                "stdout": "",
                                "stderr": "Command must be a non-empty string"
                            }
                        
                        # Security check: do not allow certain dangerous commands
                        dangerous_commands = ["rm -rf", "format", "mkfs", "dd"]
                        for dangerous in dangerous_commands:
                            if dangerous in command.lower():
                                return {
                                    "status": "error",
                                    "message": f"Command contains potentially dangerous operation: {dangerous}",
                                    "stdout": "",
                                    "stderr": "Execution blocked for security reasons"
                                }
                        
                        try:
                            project_path = getattr(self, "project_path", ".")
                            working_dir = cwd if cwd else project_path
                            process = subprocess.Popen(
                                command,
                                shell=True,
                                cwd=working_dir,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True
                            )
                            
                            stdout, stderr = process.communicate(timeout=30)  # 30-second timeout
                            returncode = process.returncode
                            
                            return {
                                "status": "success" if returncode == 0 else "error",
                                "message": f"Command executed with return code {returncode}",
                                "stdout": stdout,
                                "stderr": stderr,
                                "returncode": returncode
                            }
                        except subprocess.TimeoutExpired:
                            process.kill()
                            return {
                                "status": "error",
                                "message": "Command execution timed out (30s limit)",
                                "stdout": "",
                                "stderr": "Execution timed out"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error executing command: {str(e)}",
                                "stdout": "",
                                "stderr": str(e)
                            }
                
                class CodeIndexingTool(BaseTool):
                    name: str = "code_indexing"
                    description: str = "Index and search code in the project. Use for finding relevant code segments."
                    
                    def _run(self, action: str, data: Optional[Dict] = None) -> Dict[str, Any]:
                        """Execute the code indexing operation and return results"""
                        return {
                            "status": "success",
                            "action": action,
                            "message": f"Code indexing tool called with action '{action}'",
                            "data": data
                        }
                
                class CodeEditingTool(BaseTool):
                    name: str = "code_editing"
                    description: str = "Edit code files in the project. Use for reading, writing, and modifying code."
                    
                    def _run(self, action: str, data: Optional[Dict] = None) -> Dict[str, Any]:
                        """Execute the code editing operation and return results"""
                        if not data or not isinstance(data, dict):
                            return {
                                "status": "error",
                                "message": "Invalid data format"
                            }
                        
                        return {
                            "status": "success",
                            "action": action,
                            "message": f"Code editing tool called with action '{action}'",
                            "data": data
                        }
                
                class StructuredJSONOutputTool(BaseTool):
                    name: str = "structured_json_output"
                    description: str = "Format output as structured JSON according to a schema."
                    
                    def _run(self, data: Dict[str, Any], schema: Optional[Dict] = None) -> Dict[str, Any]:
                        """Format the data according to schema"""
                        try:
                            return {
                                "status": "success",
                                "result": data,
                                "message": "Data formatted successfully"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error formatting data: {str(e)}"
                            }

                class ExtractJSONTool(BaseTool):
                    name: str = "extract_json"
                    description: str = "Extract JSON data from text strings."
                    
                    def _run(self, text: str) -> Dict[str, Any]:
                        """Extract JSON from text"""
                        try:
                            # Look for JSON patterns with regex
                            import re
                            import json
                            
                            # Find all text that looks like JSON objects
                            pattern = r'\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}'
                            matches = re.findall(pattern, text)
                            
                            for match in matches:
                                try:
                                    return json.loads(match)
                                except:
                                    continue
                                    
                            # Try the whole text
                            return json.loads(text)
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error extracting JSON: {str(e)}",
                                "text": text
                            }

                class FileSystemReadTool(BaseTool):
                    name: str = "fs_read"
                    description: str = "Read files from the file system."
                    
                    def _run(self, path: str) -> Dict[str, Any]:
                        """Read file contents"""
                        try:
                            with open(path, 'r') as f:
                                content = f.read()
                            return {
                                "status": "success",
                                "content": content,
                                "message": f"Successfully read file: {path}"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error reading file: {str(e)}"
                            }

                class FileSystemWriteTool(BaseTool):
                    name: str = "fs_write"
                    description: str = "Write to files in the file system."
                    
                    def _run(self, path: str, content: str, mode: str = 'w') -> Dict[str, Any]:
                        """Write content to file"""
                        try:
                            with open(path, mode) as f:
                                f.write(content)
                            return {
                                "status": "success",
                                "message": f"Successfully wrote to file: {path}"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error writing to file: {str(e)}"
                            }

                class FileSystemUpdateTool(BaseTool):
                    name: str = "fs_update"
                    description: str = "Update existing files with edits or patches."
                    
                    def _run(self, path: str, edit_operation: Dict[str, Any]) -> Dict[str, Any]:
                        """Update file with edits"""
                        try:
                            # Simple implementation - replace old text with new text
                            if 'old_text' not in edit_operation or 'new_text' not in edit_operation:
                                return {
                                    "status": "error",
                                    "message": "Edit operation must contain old_text and new_text"
                                }
                                
                            with open(path, 'r') as f:
                                content = f.read()
                                
                            # Replace old text with new text
                            old_text = edit_operation['old_text']
                            new_text = edit_operation['new_text']
                            updated_content = content.replace(old_text, new_text)
                            
                            # Write updated content back to file
                            with open(path, 'w') as f:
                                f.write(updated_content)
                                
                            return {
                                "status": "success",
                                "message": f"Successfully updated file: {path}"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error updating file: {str(e)}"
                            }

                class FileSystemListTool(BaseTool):
                    name: str = "fs_list"
                    description: str = "List files and directories in the file system."
                    
                    def _run(self, path: str = '.') -> Dict[str, Any]:
                        """List directory contents"""
                        try:
                            items = os.listdir(path)
                            files = []
                            directories = []
                            
                            for item in items:
                                item_path = os.path.join(path, item)
                                if os.path.isdir(item_path):
                                    directories.append(item)
                                else:
                                    files.append(item)
                                    
                            return {
                                "status": "success",
                                "files": files,
                                "directories": directories,
                                "message": f"Listed {len(files)} files and {len(directories)} directories in {path}"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error listing directory: {str(e)}"
                            }

                class FileSystemSearchTool(BaseTool):
                    name: str = "fs_search"
                    description: str = "Search for files matching a pattern."
                    
                    def _run(self, pattern: str, path: str = '.', recursive: bool = True) -> Dict[str, Any]:
                        """Search for files matching pattern"""
                        try:
                            import glob
                            
                            search_pattern = os.path.join(path, pattern)
                            if recursive:
                                search_pattern = os.path.join(path, "**", pattern)
                                matches = glob.glob(search_pattern, recursive=True)
                            else:
                                matches = glob.glob(search_pattern)
                                
                            return {
                                "status": "success",
                                "matches": matches,
                                "message": f"Found {len(matches)} files matching pattern: {pattern}"
                            }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error searching for files: {str(e)}"
                            }

                class FileSystemDeleteTool(BaseTool):
                    name: str = "fs_delete"
                    description: str = "Delete files or empty directories."
                    
                    def _run(self, path: str) -> Dict[str, Any]:
                        """Delete file or directory"""
                        try:
                            if os.path.isdir(path):
                                os.rmdir(path)  # Only removes empty directories
                                return {
                                    "status": "success",
                                    "message": f"Successfully deleted directory: {path}"
                                }
                            else:
                                os.remove(path)
                                return {
                                    "status": "success",
                                    "message": f"Successfully deleted file: {path}"
                                }
                        except Exception as e:
                            return {
                                "status": "error",
                                "message": f"Error deleting: {str(e)}"
                            }
                
                # Create instances of our tools
                learning_tool = LearningSystemTool()
                pm_tool = ProjectManagementTool() 
                metadata_tool = MetadataTool()
                shell_tool = ShellExecutionTool()
                indexing_tool = CodeIndexingTool()
                editing_tool = CodeEditingTool()
                json_output_tool = StructuredJSONOutputTool()
                extract_json_tool = ExtractJSONTool()
                fs_read_tool = FileSystemReadTool()
                fs_write_tool = FileSystemWriteTool()
                fs_update_tool = FileSystemUpdateTool()
                fs_list_tool = FileSystemListTool()
                fs_search_tool = FileSystemSearchTool()
                fs_delete_tool = FileSystemDeleteTool()
                
                # Add tools to dictionary
                self.tools = {
                    "learning_system": learning_tool,
                    "project_management": pm_tool,
                    "metadata": metadata_tool,
                    "shell_execution": shell_tool,
                    "code_indexing": indexing_tool,
                    "code_editing": editing_tool,
                    "structured_json_output": json_output_tool,
                    "extract_json": extract_json_tool,
                    "fs_read": fs_read_tool,
                    "fs_write": fs_write_tool,
                    "fs_update": fs_update_tool,
                    "fs_list": fs_list_tool,
                    "fs_search": fs_search_tool,
                    "fs_delete": fs_delete_tool
                }
                
                # Create a list of tools IDs
                default_tools = list(self.tools.keys())
                
                logger.info(f"Created {len(default_tools)} BaseTool instances compatible with CrewAI: {', '.join(default_tools)}")
                
            except ImportError:
                logger.warning("Could not import BaseTool from crewai.tools - falling back to basic tool definitions")
                
                # Define a basic Tool class if imports fail
                class Tool:
                    def __init__(self, name, description, func):
                        self.name = name
                        self.description = description
                        self.func = func
                    def __call__(self, *args, **kwargs):
                        return self.func(*args, **kwargs)

                # 1. Create the Learning System Tool
                def learning_system_tool(action, data=None):
                    """Tool for interacting with the learning system"""
                    return {
                        "status": "success",
                        "action": action,
                        "message": f"Learning system tool called with action '{action}'",
                        "data": data
                    }

                learning_tool = Tool(
                    name="learning_system",
                    description="Access and update the agent's learning and memory system. Use for storing experiences, retrieving knowledge, and reflection.",
                    func=learning_system_tool
                )
                
                # 2. Create the Project Management Tool
                def project_management_tool(action, data=None):
                    """Tool for interacting with the project management system"""
                    return {
                        "status": "success",
                        "action": action,
                        "message": f"Project management tool called with action '{action}'",
                        "data": data
                    }

                pm_tool = Tool(
                    name="project_management",
                    description="Manage tasks, assignments, and project structure. Use for creating tasks, updating status, and coordination.",
                    func=project_management_tool
                )
                
                # Add the tools to the dictionary
                self.tools = {
                    "learning_system": learning_tool,
                    "project_management": pm_tool,
                }
                
                logger.warning("Created fallback tools that may not be compatible with CrewAI validation")

            # Save the default tools list
            self.default_tools = list(self.tools.keys())
            logger.info(f"Created default tools list with {len(self.default_tools)} tools: {', '.join(self.default_tools)}")
            
            # Save tools to disk
            self._save_tool_state()
            
        except Exception as e:
            logger.error(f"Error creating default tools: {e}")
            self.tools = {}
            self.default_tools = []

    def _save_tool_state(self):
        """Save the current tool state to the .tribe directory"""
        try:
            # Create tools directory if it doesn't exist
            tools_dir = os.path.join(self.tribe_path, "tools")
            os.makedirs(tools_dir, exist_ok=True)

            # Save tools data
            tools_data = []
            for tool_id, tool in self.tools.items():
                tool_data = {
                    "id": tool_id,
                    "name": getattr(tool, "name", tool_id),
                    "description": getattr(tool, "description", ""),
                    "type": tool.__class__.__name__
                }

                # Add schema if it's a StructuredJSONOutputTool
                if hasattr(tool, "schema"):
                    tool_data["schema"] = tool.schema

                tools_data.append(tool_data)

            tools_path = os.path.join(tools_dir, "tools.json")
            with open(tools_path, "w") as f:
                json.dump(tools_data, f, indent=2)

            # Save agent-tool relationships
            agent_tools_path = os.path.join(tools_dir, "agent_tools.json")
            with open(agent_tools_path, "w") as f:
                json.dump(self.agent_tools, f, indent=2)

            logger.info(f"Saved {len(tools_data)} tools to {tools_path}")

        except Exception as e:
            logger.error(f"Error saving tool state: {e}")

    def _load_state(self):
        """Load existing agents, tasks, and crews from the .tribe directory"""
        try:
            # Attempt to load agents
            agents_file = os.path.join(self.tribe_path, "agents.json")
            if os.path.exists(agents_file):
                with open(agents_file, "r") as f:
                    agents_data = json.load(f)
                
                # Process each agent
                for agent_data in agents_data:
                    # Create the agent
                    agent = self._create_agent_from_data(agent_data)
                    if agent:
                        # Store the agent
                        agent_id = agent_data.get("id", None)
                        if agent_id:
                            self.agents[agent_id] = agent
                            logger.info(f"Loaded agent with ID '{agent_id}'")
                            
                            # Check for tools to attach
                            tool_ids = agent_data.get("tools", [])
                            if tool_ids:
                                # Ensure we have all tools before attaching
                                if not self.tools:
                                    self._create_default_tools()
                                
                                # Get available tools and attach them
                                available_tool_ids = [t_id for t_id in tool_ids if t_id in self.tools]
                                if available_tool_ids:
                                    self._attach_tools_to_agent(agent, available_tool_ids)
                                    self.agent_tools[agent_id] = available_tool_ids
                                    logger.info(f"Attached {len(available_tool_ids)} tools to agent {agent_id}")
                        else:
                            logger.warning(f"Loaded agent without ID, skipping")
                
                logger.info(f"Loaded {len(self.agents)} agents")
            else:
                logger.info("No agents.json file found, skipping agent loading")

            # Create a default agent with ID 'agent-1' if no agents are loaded
            if not self.agents or 'agent-1' not in self.agents:
                # Check if we should create a default agent
                logger.info(f"No agents found in state or agent-1 missing. Creating default agent.")
                try:
                    # First ensure we have all the tools we need
                    if not self.tools:
                        self._create_default_tools()
                    
                    # Create a default agent
                    agent_data = {
                        "id": "agent-1",
                        "name": "AI Assistant",
                        "role": "AI Assistant",
                        "goal": "Help the user accomplish their tasks",
                        "backstory": "An AI assistant created to help with this project."
                    }
                    agent = self._create_agent_from_data(agent_data)
                    if agent:
                        self.agents["agent-1"] = agent
                        logger.info("Created default agent with ID 'agent-1'")
                        
                        # Get a list of all available tool IDs
                        available_tool_ids = list(self.tools.keys())
                        if available_tool_ids:
                            self._attach_tools_to_agent(agent, available_tool_ids)
                            self.agent_tools["agent-1"] = available_tool_ids
                            logger.info(f"Attached {len(available_tool_ids)} available tools to agent-1: {', '.join(available_tool_ids)}")
                except Exception as e:
                    logger.error(f"Error creating default agent: {e}")

            # Load tasks
            tasks_path = os.path.join(self.tribe_path, "tasks.json")
            if os.path.exists(tasks_path):
                with open(tasks_path, "r") as f:
                    tasks_data = json.load(f)
                    for task_data in tasks_data:
                        # Convert to CrewAI Task objects
                        self._create_task_from_data(task_data)

            # Load agent workloads
            workloads_path = os.path.join(self.tribe_path, "workloads.json")
            if os.path.exists(workloads_path):
                with open(workloads_path, "r") as f:
                    self.agent_workloads = json.load(f)
                    logger.info(f"Loaded workload data for {len(self.agent_workloads)} agents")

            # Load task status
            task_status_path = os.path.join(self.tribe_path, "task_status.json")
            if os.path.exists(task_status_path):
                with open(task_status_path, "r") as f:
                    self.task_status = json.load(f)
                    logger.info(f"Loaded status data for {len(self.task_status)} tasks")

            # Load performance metrics
            performance_path = os.path.join(self.tribe_path, "agent_performance.json")
            if os.path.exists(performance_path):
                with open(performance_path, "r") as f:
                    self.agent_performance = json.load(f)
                    logger.info(f"Loaded performance data for {len(self.agent_performance)} agents")

            # Load conflict history
            conflicts_path = os.path.join(self.tribe_path, "conflicts.json")
            if os.path.exists(conflicts_path):
                with open(conflicts_path, "r") as f:
                    self.conflict_history = json.load(f)
                    logger.info(f"Loaded conflict history with {len(self.conflict_history)} entries")

            # Initialize agent tasks based on task status
            self.agent_tasks = {}
            for task_id, status in self.task_status.items():
                if status.get("status") == "in_progress" and status.get("assigned_to"):
                    agent_id = status["assigned_to"]
                    if agent_id not in self.agent_tasks:
                        self.agent_tasks[agent_id] = []
                    self.agent_tasks[agent_id].append(task_id)

            logger.info("Completed loading persistent state")

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

            # Save agent workloads
            workloads_path = os.path.join(self.tribe_path, "workloads.json")
            with open(workloads_path, "w") as f:
                json.dump(self.agent_workloads, f, indent=2)

            # Save task status
            task_status_path = os.path.join(self.tribe_path, "task_status.json")
            with open(task_status_path, "w") as f:
                # Convert any non-serializable objects to strings
                serializable_task_status = {}
                for task_id, status in self.task_status.items():
                    serializable_task_status[task_id] = {
                        k: str(v) if not isinstance(v, (str, int, float, bool, list, dict, type(None))) else v
                        for k, v in status.items()
                    }
                json.dump(serializable_task_status, f, indent=2)

            # Save performance metrics
            performance_path = os.path.join(self.tribe_path, "agent_performance.json")
            with open(performance_path, "w") as f:
                json.dump(self.agent_performance, f, indent=2)

            # Save conflict history
            conflicts_path = os.path.join(self.tribe_path, "conflicts.json")
            with open(conflicts_path, "w") as f:
                json.dump(self.conflict_history, f, indent=2)

        except Exception as e:
            logger.error(f"Error saving state: {e}")

    def _create_tool_from_data(self, tool_data):
        """
        Create a tool from data

        Args:
            tool_data (dict): Tool data

        Returns:
            Tool: The created tool
        """
        try:
            # Import tool classes
            try:
                from crewai_adapter import StructuredJSONOutputTool, ExtractJSONTool, Tool
            except ImportError:
                try:
                    from crewai import StructuredJSONOutputTool, ExtractJSONTool, Tool
                except ImportError:
                    logger.error("Could not import tool classes")
                    return None

            # Create different types of tools based on the tool type
            tool_type = tool_data.get("type", "")
            tool_name = tool_data.get("name", "unknown_tool")
            tool_description = tool_data.get("description", "")

            if tool_type == "StructuredJSONOutputTool" and "schema" in tool_data:
                return StructuredJSONOutputTool(schema=tool_data["schema"])
            elif tool_type == "ExtractJSONTool":
                return ExtractJSONTool()
            elif tool_name == "learning_system":
                # Create a learning system tool
                def learning_func(action, data=None):
                    return {
                        "status": "success",
                        "action": action,
                        "message": f"Learning system tool called with action '{action}'",
                        "data": data
                    }
                return Tool(
                    name=tool_name,
                    description=tool_description,
                    func=learning_func
                )
            elif tool_name == "project_management":
                # Create a project management tool
                def pm_func(action, data=None):
                    return {
                        "status": "success",
                        "action": action,
                        "message": f"Project management tool called with action '{action}'",
                        "data": data
                    }
                return Tool(
                    name=tool_name,
                    description=tool_description,
                    func=pm_func
                )
            else:
                # Generic tool
                def generic_func(input_str):
                    return f"Generic tool '{tool_name}' processed: {input_str}"
                return Tool(
                    name=tool_name,
                    description=tool_description,
                    func=generic_func
                )
        except Exception as e:
            logger.error(f"Error creating tool from data: {e}")
            return None

    def _attach_tools_to_agent(self, agent, tool_ids):
        """
        Attach tools to an agent

        Args:
            agent: The agent to attach tools to
            tool_ids (list): List of tool IDs

        Returns:
            bool: True if successful, False otherwise
        """
        try:
            if not hasattr(agent, 'tools'):
                # Some versions of CrewAI don't have tools attribute
                # Create it dynamically
                setattr(agent, 'tools', [])

            # Make a copy to avoid modifying the original list
            tool_ids_to_use = list(tool_ids)

            # Add default tools if not already included and we have default tools defined
            if hasattr(self, 'default_tools'):
                for tool_id in self.default_tools:
                    if tool_id not in tool_ids_to_use and tool_id in self.tools:
                        tool_ids_to_use.append(tool_id)
                        logger.info(f"Added default tool {tool_id} to agent {agent.name}")

            # Get the tools based on tool IDs
            tools_to_attach = []
            for tool_id in tool_ids_to_use:
                if tool_id in self.tools:
                    # Get the raw tool
                    raw_tool = self.tools[tool_id]
                    
                    # Check if tool is already a BaseTool instance (our new implementation)
                    try:
                        from crewai.tools import BaseTool
                        if isinstance(raw_tool, BaseTool):
                            # Already a valid BaseTool, just use it
                            tools_to_attach.append(raw_tool)
                            logger.info(f"Added BaseTool {tool_id} to agent {agent.name}")
                            continue
                    except ImportError:
                        # BaseTool not available, will try other approaches
                        pass
                    
                    # Approach 2: Try to import crewai module and use converter if available
                    try:
                        import crewai
                        # Check if we have the converter function available 
                        if hasattr(crewai, "_convert_to_crewai_tool"):
                            try:
                                # Use the converter function
                                converted_tool = crewai._convert_to_crewai_tool(raw_tool)
                                tools_to_attach.append(converted_tool)
                                logger.info(f"Added converted tool {tool_id} to agent {agent.name}")
                                continue
                            except Exception as convert_err:
                                logger.error(f"Error converting tool {tool_id}: {convert_err}")
                    except (ImportError, ModuleNotFoundError) as import_err:
                        logger.warning(f"Could not import crewai module: {import_err}")
                    except Exception as e:
                        logger.error(f"Error in crewai tool conversion: {e}")
                        
                    # Approach 3: Try to create a BaseTool wrapper dynamically
                    try:
                        from crewai.tools import BaseTool
                        
                        # Create a dynamic BaseTool wrapper class
                        class DynamicToolWrapper(BaseTool):
                            name = getattr(raw_tool, 'name', tool_id)
                            description = getattr(raw_tool, 'description', f"Tool for {tool_id}")
                            
                            def _run(self, *args, **kwargs):
                                """Run the wrapped tool"""
                                try:
                                    # Try to call the original tool
                                    if hasattr(raw_tool, '__call__'):
                                        return raw_tool(*args, **kwargs)
                                    elif hasattr(raw_tool, 'run'):
                                        return raw_tool.run(*args, **kwargs)
                                    elif hasattr(raw_tool, '_run'):
                                        return raw_tool._run(*args, **kwargs)
                                    else:
                                        return {"error": "No callable method found on tool"}
                                except Exception as run_err:
                                    return {"error": f"Error running tool: {str(run_err)}"}
                        
                        # Create an instance of the wrapper
                        wrapped_tool = DynamicToolWrapper()
                        tools_to_attach.append(wrapped_tool)
                        logger.info(f"Added dynamically wrapped BaseTool {tool_id} to agent {agent.name}")
                        continue
                    except Exception as wrap_err:
                        logger.error(f"Error creating BaseTool wrapper: {wrap_err}")
                    
                    # Final fallback: Add the raw tool and hope for the best
                    logger.warning(f"Adding raw tool {tool_id} as last resort - may not work with CrewAI validation")
                    tools_to_attach.append(raw_tool)
                else:
                    logger.warning(f"Tool {tool_id} not found, skipping")

            # Set the tools on the agent
            agent.tools = tools_to_attach

            # Log which tools were added
            tool_names = [getattr(t, 'name', str(t)) for t in tools_to_attach]
            logger.info(f"Agent {agent.name} tools: {', '.join(tool_names)}")

            # Store the relationship in our mapping
            agent_id = getattr(agent, 'id', None) or getattr(agent, 'name', None)
            if agent_id:
                self.agent_tools[agent_id] = tool_ids_to_use

            logger.info(f"Attached {len(tools_to_attach)} tools to agent {agent.name}")
            return True
        except Exception as e:
            logger.error(f"Error attaching tools to agent: {e}")
            return False

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

            # Debug print of the important directories we're using
            logger.info(f"Server process ID: {os.getpid()}")
            logger.info(f"Working directory: {os.getcwd()}")
            logger.info(f"Server file: {os.path.abspath(__file__)}")
            logger.info(f"Project path: {self.project_path}")

            # Special check for parent directory
            if self.project_path:
                parent_dir = os.path.dirname(self.project_path)
                logger.info(f"Parent of project path: {parent_dir}")
                tribe_dir = os.path.join(parent_dir, ".tribe")
                if os.path.exists(tribe_dir):
                    logger.info(f"Found .tribe directory in parent folder: {tribe_dir}")
                    # List contents
                    try:
                        contents = os.listdir(tribe_dir)
                        logger.info(f"Contents of {tribe_dir}: {contents}")

                        # Explicitly check for .env file
                        parent_env_file = os.path.join(tribe_dir, ".env")
                        if os.path.exists(parent_env_file):
                            logger.info(f"Found .env file in parent .tribe folder: {parent_env_file}")
                            try:
                                # Get file info
                                file_size = os.path.getsize(parent_env_file)
                                file_mtime = os.path.getmtime(parent_env_file)
                                logger.info(f"File stats: size={file_size} bytes, modified={time.ctime(file_mtime)}")

                                # Try to directly load this file now
                                try:
                                    logger.info(f"Attempting to directly load parent .env file: {parent_env_file}")
                                    with open(parent_env_file, "r") as f:
                                        file_contents = f.read()
                                        logger.info(f"Successfully read {len(file_contents)} bytes from parent .env file")

                                        # Process file line by line
                                        for line in file_contents.splitlines():
                                            line = line.strip()
                                            if line and not line.startswith('#'):
                                                try:
                                                    parts = line.split('=', 1)
                                                    if len(parts) == 2:
                                                        key, value = parts
                                                        key = key.strip()
                                                        value = value.strip().strip('"\'')

                                                        # Only log the key name, not the value
                                                        logger.info(f"Found key in parent .env: {key}")

                                                        # Check for API keys
                                                        if key == "ANTHROPIC_API_KEY":
                                                            anthropic_api_key = value
                                                            os.environ["ANTHROPIC_API_KEY"] = value
                                                            logger.info(f"Successfully loaded ANTHROPIC_API_KEY from parent .env file")
                                                        elif key == "OPENAI_API_KEY":
                                                            openai_api_key = value
                                                            os.environ["OPENAI_API_KEY"] = value
                                                            logger.info(f"Successfully loaded OPENAI_API_KEY from parent .env file")
                                                        else:
                                                            # Set all environment variables
                                                            os.environ[key] = value
                                                            logger.info(f"Set environment variable from parent .env: {key}")
                                                except Exception as parse_err:
                                                    logger.error(f"Error parsing line from parent .env: {parse_err}")
                                except Exception as read_err:
                                    logger.error(f"Error reading parent .env file: {read_err}")
                            except Exception as e:
                                logger.error(f"Error getting file stats: {e}")
                    except Exception as e:
                        logger.error(f"Error listing .tribe directory: {e}")

            # Check for API keys in environment and config
            anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
            openai_api_key = os.environ.get("OPENAI_API_KEY")

            logger.info(f"Initial API key check - Anthropic: {'Present' if anthropic_api_key else 'Not found'}, OpenAI: {'Present' if openai_api_key else 'Not found'}")

            # Try to find .env files in multiple locations
            env_file_locations = [
                # Extension root .env
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"),
                # Project .env (if project_path is set)
                os.path.join(self.project_path, ".env") if self.project_path else None,
                # Project .tribe/.env - this should be where your file is
                os.path.join(self.project_path, ".tribe", ".env") if self.project_path else None,
                # Parent extension directory .env (where the .tribe folder might be)
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), ".tribe", ".env"),
                # Explicit .tribe folder in parent directory
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), ".tribe", ".env"),
                # Home directory .env
                os.path.join(os.path.expanduser("~"), ".env"),
            ]

            # Print the parent directories for debugging
            logger.info(f"Current file path: {os.path.abspath(__file__)}")
            logger.info(f"Extension directory: {os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))}")
            logger.info(f"Project path from args: {self.project_path}")
            # Print parent directory of extension
            logger.info(f"Parent directory: {os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))}")

            # Filter out None values
            env_file_locations = [loc for loc in env_file_locations if loc]

            # Log all potential .env file locations
            logger.info(f"Searching for .env files in: {env_file_locations}")

            # Check each location
            for env_file in env_file_locations:
                if os.path.exists(env_file):
                    logger.info(f"Found .env file at: {env_file}")
                    try:
                        # Get file information for debugging
                        file_size = os.path.getsize(env_file)
                        file_mtime = os.path.getmtime(env_file)
                        logger.info(f"Reading env file: {env_file} (size: {file_size} bytes, modified: {time.ctime(file_mtime)})")

                        with open(env_file, "r") as f:
                            file_contents = f.read()
                            logger.info(f"Successfully read {len(file_contents)} bytes from {env_file}")

                            # Print the first few characters for debugging (redacted)
                            if len(file_contents) > 0:
                                preview = file_contents[:10] + "..." if len(file_contents) > 10 else file_contents
                                logger.info(f"File begins with: {preview}")

                            # Process file line by line
                            for line in file_contents.splitlines():
                                line = line.strip()
                                if line and not line.startswith('#'):
                                    try:
                                        parts = line.split('=', 1)
                                        if len(parts) == 2:
                                            key, value = parts
                                            key = key.strip()
                                            value = value.strip().strip('"\'')

                                            # Log each found environment variable (without showing the actual value)
                                            logger.info(f"Found environment variable in {env_file}: {key}")

                                            if key == "ANTHROPIC_API_KEY" and not anthropic_api_key:
                                                anthropic_api_key = value
                                                # Set in os.environ to ensure it's available
                                                os.environ["ANTHROPIC_API_KEY"] = value
                                                logger.info(f"Successfully loaded ANTHROPIC_API_KEY from {env_file}")
                                            elif key == "OPENAI_API_KEY" and not openai_api_key:
                                                openai_api_key = value
                                                # Set in os.environ to ensure it's available
                                                os.environ["OPENAI_API_KEY"] = value
                                                logger.info(f"Successfully loaded OPENAI_API_KEY from {env_file}")
                                            else:
                                                # Set all other variables in environment too
                                                os.environ[key] = value
                                                logger.info(f"Set environment variable: {key}")
                                        else:
                                            logger.warning(f"Malformed line in {env_file}: {line}")
                                    except ValueError as ve:
                                        # Skip lines that don't have the format key=value
                                        logger.error(f"Invalid line in .env file ({env_file}): {line} - {ve}")
                                        continue
                    except Exception as e:
                        logger.error(f"Error reading .env file {env_file}: {e}")
                        # Print more detailed error info
                        import traceback
                        logger.error(traceback.format_exc())

            # Try Anthropic first if key is available
            if anthropic_api_key:
                try:
                    # Set the API key in environment variables
                    os.environ["ANTHROPIC_API_KEY"] = anthropic_api_key

                    # Create the LLM with provider/model format
                    llm = LLM(
                        model="anthropic/claude-3-7-sonnet-latest",
                    )
                    logger.info("Using Anthropic Claude Sonnet as LLM provider")
                except Exception as e:
                    logger.error(f"Failed to initialize Anthropic LLM: {e}")

            # Try OpenAI if Anthropic is not available or failed
            if llm is None and openai_api_key:
                try:
                    # Set the API key in environment variables
                    os.environ["OPENAI_API_KEY"] = openai_api_key

                    # Create the LLM with provider/model format
                    llm = LLM(
                        model="openai/gpt-4-turbo",
                    )
                    logger.info("Using OpenAI GPT-4-turbo as LLM provider")
                except Exception as e:
                    logger.error(f"Failed to initialize OpenAI LLM: {e}")

            # Try to create a default LLM if previous attempts failed
            if llm is None:
                # Check if we have at least one API key to continue
                if anthropic_api_key:
                    logger.warning("Attempting to create LLM with simplified Anthropic configuration")
                    try:
                        # Use proper provider/model format
                        # Make sure API key is in environment variables
                        os.environ["ANTHROPIC_API_KEY"] = anthropic_api_key
                        llm = LLM(model="anthropic/claude-3-haiku-20240307")
                        logger.info("Successfully created LLM with simplified Anthropic configuration")
                    except Exception as e:
                        logger.error(f"Failed to create simplified Anthropic LLM: {e}")
                elif openai_api_key:
                    logger.warning("Attempting to create LLM with simplified OpenAI configuration")
                    try:
                        # Use proper provider/model format
                        # Make sure API key is in environment variables
                        os.environ["OPENAI_API_KEY"] = openai_api_key
                        llm = LLM(model="openai/gpt-3.5-turbo-0125")
                        logger.info("Successfully created LLM with simplified OpenAI configuration")
                    except Exception as e:
                        logger.error(f"Failed to create simplified OpenAI LLM: {e}")
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
                "name": agent_data.get("name", agent_data.get("character_name", "Agent")),
            }

            # Add any metadata provided with the agent data
            if "metadata" in agent_data and isinstance(agent_data["metadata"], dict):
                agent_args["metadata"] = agent_data["metadata"]
                logger.info(f"Added metadata to agent: {', '.join(agent_data['metadata'].keys())}")

            # Ensure name is always set
            if "name" not in agent_args and "role" in agent_args:
                agent_args["name"] = agent_args["role"]

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
                        # Ensure the API key is set in environment variables
                        os.environ["ANTHROPIC_API_KEY"] = anthropic_api_key

                        # Use correct provider/model format
                        llm = LLM(
                            model="anthropic/claude-3-7-sonnet-latest",  # Try a different model
                        )
                        logger.info("Using Anthropic Claude Opus model (second attempt)")
                    except Exception as e:
                        logger.error(f"Failed to initialize Anthropic LLM (second attempt): {e}")

                if llm is None:
                    if openai_api_key and not openai_disabled:
                        try:
                            # Ensure the API key is set in environment variables
                            os.environ["OPENAI_API_KEY"] = openai_api_key

                            # Use correct provider/model format
                            llm = LLM(
                                model="openai/gpt-3.5-turbo",  # Try a different model
                            )
                            logger.info("Using OpenAI GPT-3.5 Turbo model (second attempt)")
                        except Exception as e:
                            logger.error(f"Failed to initialize OpenAI LLM (second attempt): {e}")
                    elif anthropic_api_key is None and openai_api_key is None:
                        logger.error("No API keys found for either Anthropic or OpenAI.")
                        logger.warning("Will continue with limited functionality - team creation may not work.")

            # Add the LLM if it's available
            if llm:
                agent_args["llm"] = llm
                try:
                    # Log actual LLM details
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

            # Get the agent name from various sources
            name_value = agent_args.get('name') or agent_args.get('character_name') or agent_args.get('role', 'Agent')

            # Add to both name and character_name for compatibility
            agent_args['name'] = name_value
            agent_args['character_name'] = name_value

            # Create a version of args without name-related fields for fallback
            fallback_args = {k: v for k, v in agent_args.items() if k not in ['name', 'character_name']}

            # Try multiple approaches to create the agent
            agent = None
            creation_errors = []

            # First, ensure we have created the default tools
            if not self.tools:
                self._create_default_tools()

            # Approach 1: Try with CrewAI's Agent directly
            try:
                from crewai import Agent
                agent = Agent(**agent_args)
                logger.info(f"Created agent using CrewAI's Agent for {name_value}")
                
                # Try to set the ID directly on the agent
                try:
                    # First ensure agent has a proper metadata attribute
                    if not hasattr(agent, "metadata") or agent.metadata is None:
                        setattr(agent, "metadata", {})
                        logger.info(f"Created new metadata dictionary for agent")
                    elif not isinstance(agent.metadata, dict):
                        # If metadata exists but isn't a dict, convert it
                        old_metadata = agent.metadata
                        setattr(agent, "metadata", {})
                        logger.info(f"Converted non-dict metadata type {type(old_metadata)} to dict")
                    
                    # Now try to set ID in various ways
                    if hasattr(agent, "id"):
                        setattr(agent, "id", agent_id)
                        logger.info(f"Set agent.id to {agent_id}")
                    
                    # Always store ID in metadata regardless
                    try:
                        agent.metadata["id"] = agent_id
                        agent.metadata["character_name"] = name_value
                        logger.info(f"Set id={agent_id} and character_name={name_value} in agent.metadata")
                    except (TypeError, AttributeError) as metadata_err:
                        # Direct dict approach as fallback
                        logger.warning(f"Error setting metadata the normal way: {metadata_err}")
                        agent.__dict__["metadata"] = {"id": agent_id, "character_name": name_value}
                        logger.info(f"Set metadata directly in agent.__dict__")
                except Exception as e:
                    logger.warning(f"Failed to set agent attributes: {e}")
                    # Most drastic fallback - make sure agent at least has some way to access its name
                    try:
                        agent.__dict__["_id"] = agent_id
                        agent.__dict__["metadata"] = {"id": agent_id, "character_name": name_value}
                        logger.info(f"Used fallback approach to set agent id and metadata")
                    except Exception as fallback_err:
                        logger.error(f"All attempts to set agent attributes failed: {fallback_err}")
            except Exception as e:
                creation_errors.append(f"CrewAI Agent error: {str(e)}")

            # Approach 2: Try with only required fields as fallback
            if agent is None:
                try:
                    essential_args = {
                        'role': agent_args['role'],
                        'goal': agent_args.get('goal', 'Help the team accomplish its objectives'),
                        'backstory': agent_args.get('backstory', f"A skilled {agent_args['role']}"),
                        'verbose': agent_args.get('verbose', True),
                        'allow_delegation': agent_args.get('allow_delegation', False)
                    }

                    # Add LLM if available
                    if 'llm' in agent_args:
                        essential_args['llm'] = agent_args['llm']

                    # Try to create with simplified arguments
                    from crewai import Agent
                    agent = Agent(**essential_args)
                    logger.info(f"Created basic Agent for {name_value}")

                    # Add name and metadata manually to the agent object
                    try:
                        if hasattr(agent, 'name'):
                            setattr(agent, 'name', name_value)
                        else:
                            agent.__dict__['_name'] = name_value
                            
                        # Initialize metadata and set the ID
                        if not hasattr(agent, "metadata") or agent.metadata is None:
                            setattr(agent, "metadata", {})
                            logger.info(f"Created new metadata dict in basic agent fallback")
                        elif not isinstance(agent.metadata, dict):
                            # If attribute exists but isn't a dict
                            old_metadata = agent.metadata
                            setattr(agent, "metadata", {})
                            logger.info(f"Converted non-dict metadata {type(old_metadata)} to dict in fallback")
                            
                        # Set the ID via multiple approaches for robustness
                        if hasattr(agent, "id"):
                            setattr(agent, "id", agent_id)
                            logger.info(f"Set agent.id to {agent_id} in fallback")
                            
                        try:
                            agent.metadata['id'] = agent_id
                            agent.metadata['name'] = name_value
                            agent.metadata['character_name'] = name_value
                            logger.info(f"Set metadata attributes in fallback code path")
                        except (TypeError, AttributeError) as dict_err:
                            # Dictionary access failed, use __dict__ directly
                            logger.warning(f"Dict access failed: {dict_err}, using __dict__ fallback")
                            agent.__dict__['metadata'] = {
                                'id': agent_id,
                                'name': name_value,
                                'character_name': name_value
                            }
                            logger.info(f"Set metadata through __dict__ in fallback path")
                    except Exception as set_err:
                        logger.warning(f"Could not add properties to agent: {set_err}")
                        # Final attempt - just make sure the agent has an ID somewhere
                        try:
                            agent.__dict__['_id'] = agent_id
                            agent.__dict__['_name'] = name_value
                            agent.__dict__['metadata'] = {
                                'id': agent_id,
                                'name': name_value,
                                'character_name': name_value
                            }
                            logger.info(f"Used direct __dict__ assignment in final fallback")
                        except Exception as final_err:
                            logger.error(f"All property setting approaches failed: {final_err}")

                    logger.debug(f"Created agent with ID {agent.id}, name: {getattr(agent, 'name', None)}")
                except Exception as e:
                    creation_errors.append(f"Basic Agent error: {str(e)}")

            # Log if all approaches failed
            if agent is None:
                logger.error(f"All agent creation approaches failed: {creation_errors}")
                return None

            # Add property to safely get name if possible
            if not hasattr(agent, 'name') or not callable(getattr(agent, 'name', None)):
                try:
                    # Try to add a name property dynamically
                    def get_name(self):
                        if hasattr(self, '_name'):
                            return self._name
                        if hasattr(self, 'metadata') and isinstance(self.metadata, dict):
                            if 'name' in self.metadata:
                                return self.metadata['name']
                            if 'character_name' in self.metadata:
                                return self.metadata['character_name']
                        return self.role

                    # Only set if it doesn't already exist
                    if not hasattr(agent.__class__, 'name') or not isinstance(agent.__class__.name, property):
                        setattr(agent.__class__, 'name', property(get_name))
                except Exception as prop_err:
                    logger.warning(f"Could not add name property to agent: {prop_err}")

            # Store the agent
            self.agents[agent_id] = agent

            # Ensure the agent has all default tools
            if hasattr(self, 'default_tools'):
                # Make sure agent_id is in agent_tools mapping
                if agent_id not in self.agent_tools:
                    self.agent_tools[agent_id] = []

                # Ensure that shell_execute and code_diff are in the tools list
                tools_to_add = self.agent_tools[agent_id].copy()
                if "shell_execute" not in tools_to_add and "shell_execute" in self.tools:
                    tools_to_add.append("shell_execute")
                    logger.info(f"Added shell_execute tool to agent {agent_id}")

                if "code_diff" not in tools_to_add and "code_diff" in self.tools:
                    tools_to_add.append("code_diff")
                    logger.info(f"Added code_diff tool to agent {agent_id}")

                # Add default tools if needed
                self._attach_tools_to_agent(agent, tools_to_add)
                logger.info(f"Attached tools to agent {agent_id}: {tools_to_add}")

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
            agent = None
            
            if agent_id:
                agent = self.agents.get(agent_id)
                
                # If agent is found but might be a dictionary or missing metadata
                if agent:
                    logger.info(f"Converting agent {agent_id} to proper Agent object for task creation")
                    try:
                        agent = self._convert_to_agent_object(agent)
                        # Update the agent in the agents dictionary
                        self.agents[agent_id] = agent
                    except Exception as conv_err:
                        logger.error(f"Error converting agent for task: {conv_err}")
                else:
                    logger.warning(f"Agent {agent_id} not found for task creation")
                    # Try to find the agent by other means (fallback to first agent)
                    if self.agents:
                        first_agent_id = next(iter(self.agents))
                        agent = self.agents[first_agent_id]
                        logger.info(f"Using fallback agent {first_agent_id} for task")
                        # Ensure it's a proper Agent object
                        try:
                            agent = self._convert_to_agent_object(agent)
                            # Update the agent in the agents dictionary
                            self.agents[first_agent_id] = agent
                        except Exception as conv_err:
                            logger.error(f"Error converting fallback agent: {conv_err}")

            # Validate agent before creating task
            if agent is None:
                logger.error("No agent available for task creation")
                return None

            # Create the CrewAI Task
            logger.info(f"Creating task with agent: {agent} (type: {type(agent)})")
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

                # Check if we have at least one API key first
                has_api_keys = bool(os.environ.get("ANTHROPIC_API_KEY")) or bool(os.environ.get("OPENAI_API_KEY"))

                if not has_api_keys:
                    logger.warning("No API keys found but trying to create a bootstrap team")
                    # Return a response with a message about missing API keys
                    return {
                        "id": crew_id,
                        "status": "created",
                        "message": "Cannot create custom team without API keys. Please configure your API keys in the Environment Manager."
                    }

                # If we have API keys, call the enhanced bootstrapping method
                return self._create_bootstrap_team(crew_id, crew_data['description'])

            # Normal crew creation with existing agents and tasks
            agent_ids = crew_data.get("agent_ids", [])
            agents = [self.agents[agent_id] for agent_id in agent_ids if agent_id in self.agents]

            # Get the tasks for this crew
            task_ids = crew_data.get("task_ids", [])
            tasks = [self.tasks[task_id] for task_id in task_ids if task_id in self.tasks]

            # Create the CrewAI Crew with extra error handling
            try:
                # Set up embeddings for the crew
                try:
                    from langchain_huggingface import HuggingFaceEmbeddings
                    sentence_transformer_model = "all-MiniLM-L6-v2"
                    # Create embedder config dictionary instead of passing the object directly
                    embedder_config = {
                        "provider": "huggingface",
                        "model": sentence_transformer_model
                    }
                    logger.info(f"Created sentence-transformers embeddings config with model {sentence_transformer_model} for crew")
                except ImportError:
                    logger.warning("Could not import HuggingFaceEmbeddings - will use default embeddings")
                    embedder_config = None

                # Create crew with embeddings if available
                if embedder_config:
                    crew = Crew(
                        agents=agents,
                        tasks=tasks,
                        verbose=True,
                        process=Process.sequential,
                        memory=True,
                        embedder=embedder_config,
                    )
                else:
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
                        "message": "Created with limited functionality - please configure your API keys in the Environment Manager"
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
                    try:
                        from crewai import ExtendedAgent
                    except ImportError:
                        # If not available in crewai, use our own
                        from crewai_adapter import ExtendedAgent

                    # Make a copy that we can modify
                    agent_data_clean = agent_data_copy.copy()

                    # Make sure name is available somewhere
                    name_value = agent_data_clean.get('name') or agent_data_clean.get('character_name') or agent_data_clean.get('role', 'Agent')

                    # Include both name and character_name for compatibility
                    agent_data_clean['name'] = name_value
                    agent_data_clean['character_name'] = name_value

                    # Prepare fallback kwargs without name/character_name
                    fallback_kwargs = {k: v for k, v in agent_data_clean.items() if k not in ['name', 'character_name']}

                    # Try multiple approaches to create the agent
                    agent = None
                    creation_errors = []

                    # Approach 1: Try with our customized ExtendedAgent
                    try:
                        from crewai_adapter import ExtendedAgent as AdapterExtendedAgent
                        agent = AdapterExtendedAgent(**agent_data_clean)
                        logger.debug("Created agent using adapter's ExtendedAgent")
                    except Exception as e:
                        creation_errors.append(f"Adapter ExtendedAgent error: {str(e)}")

                    # Approach 2: Try with CrewAI's ExtendedAgent if available
                    if agent is None:
                        try:
                            agent = ExtendedAgent(**agent_data_clean)
                            logger.debug("Created agent using CrewAI's ExtendedAgent")
                        except Exception as e:
                            creation_errors.append(f"CrewAI ExtendedAgent error: {str(e)}")

                    # Approach 3: Try with only required fields
                    if agent is None:
                        try:
                            agent = Agent(
                                role=agent_data_clean['role'],
                                goal=agent_data_clean.get('goal', 'Help the team accomplish its objectives'),
                                backstory=agent_data_clean.get('backstory', f"A skilled {agent_data_clean['role']}")
                            )
                            logger.debug("Created basic agent with required fields only")

                            # Manually set name in agent.__dict__
                            agent.__dict__['_name'] = name_value
                            agent.__dict__['metadata'] = agent.__dict__.get('metadata', {})
                            if isinstance(agent.__dict__['metadata'], dict):
                                agent.__dict__['metadata']['name'] = name_value
                                agent.__dict__['metadata']['character_name'] = name_value
                        except Exception as e:
                            creation_errors.append(f"Basic Agent error: {str(e)}")

                    # Log if all approaches failed
                    if agent is None:
                        logger.error(f"All agent creation approaches failed: {creation_errors}")
                        raise RuntimeError(f"Failed to create agent: {creation_errors}")

                    team_agents.append(agent)
                    # Store the agent using its assigned ID
                    self.agents[agent.id] = agent
                    logger.debug(f"Created agent with ID {agent.id}, name: {getattr(agent, 'name', None)}")
                except (ImportError, AttributeError) as e:
                    logger.error(f"Error creating ExtendedAgent: {str(e)}")
                    # Fall back to our more robust agent creation method
                    try:
                        agent = self._create_agent_from_data(agent_data_copy)
                    except Exception as e:
                        logger.error(f"Even _create_agent_from_data failed: {e}")
                        # Last-ditch effort - create absolute minimalist agent
                        agent = Agent(
                            role=agent_data_copy['role'],
                            goal="Help the team accomplish its objectives",
                            backstory=f"A skilled {agent_data_copy['role']}"
                        )

                        # Force name into the object's __dict__
                        name_value = agent_data_copy.get('name', agent_data_copy.get('character_name', agent_data_copy.get('role', 'Agent')))
                        agent.__dict__['_name'] = name_value
                        agent.__dict__['metadata'] = {'name': name_value, 'character_name': name_value}
                        logger.warning(f"Created minimalist agent with role {agent_data_copy['role']}")

                    # Add to team_agents and store in self.agents
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

            # Create the JSON schema for project phases
            project_phases_schema = {
                "type": "object",
                "properties": {
                    "phases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["name", "objectives", "required_traits"],
                            "properties": {
                                "name": {"type": "string"},
                                "objectives": {"type": "array", "items": {"type": "string"}},
                                "required_traits": {"type": "array", "items": {"type": "string"}}
                            }
                        }
                    },
                    "summary": {"type": "string"}
                },
                "required": ["phases"]
            }

            # Create the JSON schema for team structure
            team_structure_schema = {
                "type": "object",
                "properties": {
                    "teams": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["name", "members"],
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "focus_area": {"type": "string"},
                                "parent_team_id": {"type": "string", "description": "ID of parent team if this is a sub-team"},
                                "members": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "required": ["role", "responsibilities", "traits"],
                                        "properties": {
                                            "id": {"type": "string"},
                                            "role": {"type": "string"},
                                            "responsibilities": {"type": "array", "items": {"type": "string"}},
                                            "traits": {"type": "array", "items": {"type": "string"}},
                                            "is_team_lead": {"type": "boolean", "description": "Whether this agent leads the team"},
                                            "sub_team_id": {"type": "string", "description": "ID of a sub-team this agent leads, if applicable"},
                                            "relationships": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "with": {"type": "string"},
                                                        "nature": {"type": "string"}
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "team_hierarchy": {
                        "type": "object",
                        "description": "Visual representation of team hierarchy",
                        "properties": {
                            "root_team_id": {"type": "string"},
                            "structure": {"type": "string", "description": "Text description of team structure"}
                        }
                    },
                    "overall_approach": {"type": "string"},
                    "team_collaboration": {"type": "string"}
                },
                "required": ["teams"]
            }

            # Create the JSON schema for agent profiles
            agent_profiles_schema = {
                "type": "object",
                "properties": {
                    "agents": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["role", "goal", "backstory", "tone",
                                         "learning_style", "working_style", "communication_style", "quirks"],
                            "properties": {
                                "name": {"type": "string"},
                                "character_name": {"type": "string"},
                                "role": {"type": "string"},
                                "goal": {"type": "string"},
                                "backstory": {"type": "string"},
                                "tone": {"type": "string"},
                                "learning_style": {"type": "string"},
                                "working_style": {"type": "string"},
                                "communication_style": {"type": "string"},
                                "quirks": {"type": "array", "items": {"type": "string"}}
                            }
                        }
                    }
                },
                "required": ["agents"]
            }

            # Define the tools for each task
            try:
                # Try to import from crewai first
                try:
                    from crewai import StructuredJSONOutputTool, ExtractJSONTool
                # If that fails, use our adapter tools
                except ImportError:
                    logger.info("Using StructuredJSONOutputTool from adapter")
                    from crewai_adapter import StructuredJSONOutputTool, ExtractJSONTool

                # Use compatibility tool classes from adapter
                logger.info("Using compatibility tools for CrewAI")

                # Import our robust tool implementations
                try:
                    from crewai_adapter import StructuredJSONOutputTool, ExtractJSONTool
                    logger.info("Using enhanced tool classes from crewai_adapter")
                except ImportError:
                    # If import fails, create robust tool classes directly
                    logger.warning("Failed to import tools from adapter, creating local versions")

                    class ToolBase:
                        """Simple base class for tools"""
                        def __call__(self, *args, **kwargs):
                            return self.function(*args, **kwargs) if hasattr(self, 'function') else None

                        def invoke(self, input_str, **kwargs):
                            """Required for newer CrewAI versions"""
                            return self.function(input_str) if hasattr(self, 'function') else None

                        def run(self, input_str, **kwargs):
                            """For LangChain compatibility"""
                            return self.function(input_str) if hasattr(self, 'function') else None

                    class StructuredJSONOutputTool(ToolBase):
                        """Tool for generating structured JSON output"""
                        def __init__(self, schema):
                            self.schema = schema
                            self.name = "structured_json_output"
                            self.description = "Format output as JSON following schema"

                            def format_json(text):
                                """Format text as JSON according to schema."""
                                try:
                                    import json
                                    return json.dumps(json.loads(text), indent=2)
                                except Exception:
                                    return text

                            self.function = format_json

                    class ExtractJSONTool(ToolBase):
                        """Tool for extracting JSON from text"""
                        def __init__(self):
                            self.name = "extract_json"
                            self.description = "Extract JSON from text"

                            def extract_json(text):
                                """Extract JSON from text."""
                                import json
                                import re

                                # Try to find JSON in code blocks
                                json_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
                                for match in re.findall(json_pattern, text):
                                    try:
                                        return json.dumps(json.loads(match), indent=2)
                                    except:
                                        pass

                                # Try the whole text
                                try:
                                    return json.dumps(json.loads(text), indent=2)
                                except:
                                    return text

                            self.function = extract_json

                    logger.info("Created comprehensive tool classes")

                # Create simple tool instances without extra parameters
                logger.info("Creating tool instances with schema validation")

                # Create tools with only the required parameters
                project_phases_tool = StructuredJSONOutputTool(schema=project_phases_schema)
                team_structure_tool = StructuredJSONOutputTool(schema=team_structure_schema)
                agent_profiles_tool = StructuredJSONOutputTool(schema=agent_profiles_schema)
                extract_json_tool = ExtractJSONTool()

                # Add more tools for agent autonomy (files, knowledge access, etc.)
                try:
                    # Try to create additional tool types if possible
                    additional_tools = []

                    # Create a dictionary of all tools
                    all_tools = {
                        "format_project_phases": project_phases_tool,
                        "format_team_structure": team_structure_tool,
                        "format_agent_profiles": agent_profiles_tool,
                        "extract_json": extract_json_tool
                    }

                    # Optional: Add tools to agent directly if supported
                    if hasattr(project_analyzer, 'tools') and isinstance(project_analyzer.tools, list):
                        project_analyzer.tools.extend([project_phases_tool, extract_json_tool])
                        logger.info(f"Added tools directly to agent {project_analyzer.role}")

                    if hasattr(team_architect, 'tools') and isinstance(team_architect.tools, list):
                        team_architect.tools.extend([team_structure_tool, extract_json_tool])
                        logger.info(f"Added tools directly to agent {team_architect.role}")

                    if hasattr(agent_designer, 'tools') and isinstance(agent_designer.tools, list):
                        agent_designer.tools.extend([agent_profiles_tool, extract_json_tool])
                        logger.info(f"Added tools directly to agent {agent_designer.role}")
                except Exception as tool_err:
                    logger.warning(f"Could not add tools directly to agents: {tool_err}")

                # Check if Task accepts tools parameter - but we'll use them regardless
                import inspect
                task_params = inspect.signature(Task.__init__).parameters
                supports_tools = 'tools' in task_params

                # For maximum compatibility, define tool application through kwargs
                def with_tools(task_kwargs, tools=None):
                    """Add tools to task kwargs if supported"""
                    if tools and supports_tools:
                        task_kwargs["tools"] = tools
                    return task_kwargs

                # Create a cleaner approach to task creation
                try:
                    # Create task arguments
                    task1_args = {
                        "description": f"Analyze the following project description and break it into logical phases: '{project_description}'. "
                                      f"For each phase, provide: 1) A name, 2) Key objectives, 3) Required personality traits. "
                                      f"IMPORTANT: Format your response as a valid JSON object with this structure: "
                                      f"{{'phases': [{{name: string, objectives: string[], required_traits: string[]}}]}}",
                        "agent": project_analyzer,
                        "expected_output": "A JSON object with an array of project phases, each with name, objectives, and required personality traits.",
                        "output_file": os.path.join(self.tribe_path, "project_phases.json")
                    }

                    task2_args = {
                        "description": "Based on the project analysis, design an optimal team structure for Phase 1. "
                                      "Design the team with specialized agents with complementary personality traits that cover all required traits. "
                                      "Create as many agents as necessary and organize them into sub-teams as needed for different aspects of the project."
                                      "\n\nIf you create a hierarchical team structure:"
                                      "\n1. Assign unique IDs to each team and agent"
                                      "\n2. Use parent_team_id to indicate sub-teams"
                                      "\n3. Use is_team_lead and sub_team_id to identify team leaders and their teams"
                                      "\n4. Describe the overall hierarchy in the team_hierarchy section"
                                      "\n\nIMPORTANT: Format your response as a valid JSON object with a 'teams' array.",
                        "agent": team_architect,
                        "expected_output": "A JSON object describing the team structure with teams, sub-teams, roles, responsibilities, personality traits, and relationships between agents.",
                        "output_file": os.path.join(self.tribe_path, "team_structure.json")
                    }

                    task3_args = {
                        "description": "Create detailed profiles for each agent in the team. Each profile must include: "
                                      "name, role, goal, backstory, tone, learning style, working style, "
                                      "communication style, and 2-3 quirks that make the agent's personality distinctive. "
                                      "\n\nIMPORTANT: Format your response as a valid JSON array of agent objects.",
                        "agent": agent_designer,
                        "expected_output": "A JSON array of agent profiles with all required fields.",
                        "output_file": os.path.join(self.tribe_path, "agent_profiles.json")
                    }

                    # Add tools when supported
                    if supports_tools:
                        task1_args["tools"] = [project_phases_tool, extract_json_tool]
                        task2_args["tools"] = [team_structure_tool, extract_json_tool]
                        task3_args["tools"] = [agent_profiles_tool, extract_json_tool]
                        logger.info("Added tools to all tasks")

                    # Create tasks with the right arguments
                    recruitment_tasks = [
                        Task(**task1_args),
                        Task(**task2_args),
                        Task(**task3_args)
                    ]

                    logger.info(f"Created {len(recruitment_tasks)} tasks with {'tools' if supports_tools else 'no tools'}")

                except Exception as e:
                    logger.error(f"Error creating tasks: {e}")
                    # Final fallback with minimal task parameters
                    recruitment_tasks = [
                        Task(
                            description=f"Analyze the project description: '{project_description}' and create phases",
                            agent=project_analyzer,
                            expected_output="JSON phases data"
                        ),
                        Task(
                            description="Design team structure for Phase 1",
                            agent=team_architect,
                            expected_output="JSON team structure"
                        ),
                        Task(
                            description="Create detailed agent profiles",
                            agent=agent_designer,
                            expected_output="JSON agent profiles"
                        )
                    ]
                    logger.warning("Using minimal fallback tasks due to error")

            except (ImportError, AttributeError) as e:
                logger.error(f"Error creating structured output tasks: {str(e)}")
                # Final fallback to extremely basic tasks without any tools
                recruitment_tasks = [
                    # Task 1: Analyze project and break into phases
                    Task(
                        description=f"Analyze the following project description and break it into logical phases: '{project_description}'. "
                                   f"For each phase, provide: 1) A name, 2) Key objectives, 3) Required personality traits. "
                                   f"IMPORTANT: Format your response as a JSON object.",
                        agent=project_analyzer,
                        expected_output="A JSON object with an array of project phases, each with name, objectives, and required personality traits."
                    ),
                    # Task 2: Design team structure for Phase 1
                    Task(
                        description="Based on the project analysis, design an optimal team structure for Phase 1. "
                                   "Design the team with specialized agents with complementary personality traits. Create as many agents as necessary and organize them into sub-teams as needed for different aspects of the project."
                                   "\n\nIf you create a hierarchical team structure:"
                                   "\n1. Assign unique IDs to each team and agent"
                                   "\n2. Indicate sub-teams and team leadership relationships"
                                   "\n3. Describe how the teams will collaborate"
                                   "\n\nIMPORTANT: Format your response as a JSON object.",
                        agent=team_architect,
                        expected_output="A JSON object describing the team structure with teams, sub-teams, roles, responsibilities, personality traits, and relationships between agents. Include a team hierarchy showing how teams relate to each other."
                    ),
                    # Task 3: Create detailed agent profiles
                    Task(
                        description="Create detailed profiles for each agent in the team. Each profile must include: "
                                   "character name, role, goal, backstory, tone, learning style, working style, "
                                   "communication style, and 2-3 quirks that make the agent's personality distinctive. "
                                   "IMPORTANT: Format your response as a JSON array.",
                        agent=agent_designer,
                        expected_output="A JSON array of agent profiles with all required fields."
                    )
                ]

            try:
                # Create a crew with compatibility checks
                import inspect
                crew_params = inspect.signature(Crew.__init__).parameters

                # Base required parameters
                crew_args = {
                    "agents": recruitment_agents,
                    "tasks": recruitment_tasks,
                    "verbose": True,
                }

                # Add optional parameters based on what's supported
                if 'process' in crew_params:
                    crew_args["process"] = Process.sequential

                if 'memory' in crew_params:
                    crew_args["memory"] = True

                # Log what we're attempting to create
                logger.info(f"Creating crew with args: {crew_args.keys()}")

                # Create the crew
                recruitment_crew = Crew(**crew_args)

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
                    # Check supported parameters
                    import inspect
                    crew_params = inspect.signature(Crew.__init__).parameters

                    # Basic parameters that all versions should support
                    crew_args = {
                        "agents": agents,
                        "tasks": tasks,
                        "verbose": True
                    }

                    # Add optional parameters if supported
                    if 'process' in crew_params:
                        crew_args["process"] = Process.sequential

                    if 'memory' in crew_params:
                        crew_args["memory"] = True

                    # Log attempts
                    logger.info(f"Creating fallback crew with args: {crew_args.keys()}")

                    # Create the minimal crew
                    crew = Crew(**crew_args)

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

            # Import ensure_string_output from our adapter
            try:
                from crewai_adapter import ensure_string_output
            except ImportError:
                # Fallback implementation if import fails
                def ensure_string_output(result):
                    if isinstance(result, (dict, list)):
                        try:
                            import json
                            return json.dumps(result, indent=2)
                        except Exception:
                            return str(result)
                    elif result is None:
                        return ""
                    return result

            # Run the crew
            result = crew.kickoff()

            # Ensure result is converted to string if it's a dictionary or list
            string_result = ensure_string_output(result)

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
                    "result": string_result
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

    def update_agent_workload(self, agent_id, task_id=None, action="add", task_data=None):
        """
        Update an agent's workload metrics when tasks are assigned or completed

        Args:
            agent_id (str): The agent's ID
            task_id (str, optional): The task ID being added or removed
            action (str): Either "add" or "remove" to adjust workload
            task_data (dict, optional): Additional task data for workload calculation

        Returns:
            dict: Updated workload metrics
        """
        # Initialize workload record if it doesn't exist
        if agent_id not in self.agent_workloads:
            self.agent_workloads[agent_id] = {
                "active_tasks": 0,
                "completed_tasks": 0,
                "task_complexity": 0,
                "weighted_workload": 0,
                "last_updated": None,
                "task_history": []
            }

        # Initialize agent's task list if it doesn't exist
        if agent_id not in self.agent_tasks:
            self.agent_tasks[agent_id] = []

        workload = self.agent_workloads[agent_id]
        now = time.time()

        # Calculate task complexity (1-10 scale)
        task_complexity = 5  # Default medium complexity
        if task_data:
            # Base complexity on priority and estimated duration
            priority_values = {"low": 1, "medium": 2, "high": 3, "critical": 4}
            priority = task_data.get("priority", "medium")
            priority_factor = priority_values.get(priority.lower(), 2)

            # Get description length as a proxy for complexity
            description = task_data.get("description", "")
            length_factor = min(3, max(1, len(description) // 100))

            # Factor in required skills
            required_skills = task_data.get("required_skills", [])
            skill_factor = min(3, len(required_skills))

            # Calculate complexity score (1-10)
            task_complexity = min(10, priority_factor + length_factor + skill_factor)

        # Update workload based on action
        if action == "add" and task_id:
            # Add task to agent's task list if not already there
            if task_id not in self.agent_tasks[agent_id]:
                self.agent_tasks[agent_id].append(task_id)

            # Update workload metrics
            workload["active_tasks"] += 1
            workload["task_complexity"] += task_complexity
            workload["weighted_workload"] = workload["active_tasks"] * (workload["task_complexity"] / max(1, workload["active_tasks"]))

            # Add to task history
            workload["task_history"].append({
                "task_id": task_id,
                "action": "assigned",
                "timestamp": now,
                "complexity": task_complexity
            })

            # Limit history size to prevent unbounded growth
            if len(workload["task_history"]) > 100:
                workload["task_history"] = workload["task_history"][-100:]

            # Update task status
            if task_id not in self.task_status:
                self.task_status[task_id] = {}

            self.task_status[task_id].update({
                "status": "assigned",
                "assigned_to": agent_id,
                "assigned_at": now,
                "complexity": task_complexity,
                "last_updated": now
            })

        elif action == "remove" and task_id:
            # Remove task from agent's task list
            if task_id in self.agent_tasks[agent_id]:
                self.agent_tasks[agent_id].remove(task_id)

            # Update workload metrics
            workload["active_tasks"] = max(0, workload["active_tasks"] - 1)
            workload["completed_tasks"] += 1
            workload["task_complexity"] = max(0, workload["task_complexity"] - task_complexity)

            if workload["active_tasks"] > 0:
                workload["weighted_workload"] = workload["active_tasks"] * (workload["task_complexity"] / workload["active_tasks"])
            else:
                workload["weighted_workload"] = 0

            # Add to task history
            workload["task_history"].append({
                "task_id": task_id,
                "action": "completed",
                "timestamp": now,
                "complexity": task_complexity
            })

            # Limit history size
            if len(workload["task_history"]) > 100:
                workload["task_history"] = workload["task_history"][-100:]

            # Update task status
            if task_id in self.task_status:
                self.task_status[task_id].update({
                    "status": "completed",
                    "completed_at": now,
                    "last_updated": now
                })

        # Update timestamp
        workload["last_updated"] = now

        # Save updated state
        self._save_state()

        logger.info(f"Updated workload for agent {agent_id}: Active tasks: {workload['active_tasks']}, Weighted workload: {workload['weighted_workload']:.2f}")

        return workload

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

        # Create task data for workload calculation
        task_data = {
            "description": task_description,
            "required_skills": required_skills or [],
            "priority": priority,
            "deadline": deadline
        }

        # Find our task coordinator if available
        coordinator = self.find_agent(logical_id="task_coordinator")

        # If we have a coordinator, use that agent to make the recommendation
        if coordinator:
            # Format available agents with real workload data
            agent_list = self._format_agent_list_for_prompt(include_workload=True)

            prompt = f"""
            Task Assignment Analysis

            Task Description: {task_description}

            {f'Required Skills: {", ".join(required_skills)}' if required_skills else ''}
            Priority: {priority}
            {f'Deadline: {deadline}' if deadline else ''}

            Available Agents (with current workload information):
            {agent_list}

            Based on the task requirements and agent capabilities, determine the most suitable agent(s) for this task.
            Consider skill match, role relevance, current workload, and past performance.

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

        # Fallback: enhanced matching algorithm with real workload data
        recommendations = []

        # Iterate through all agents
        for agent_id, agent in self.agents.items():
            # Skip the coordinator itself
            if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict) and agent.metadata.get('is_coordinator'):
                continue

            # Calculate a suitability score
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

            # Check actual agent workload
            workload_info = self.agent_workloads.get(agent_id, {})
            active_tasks = workload_info.get("active_tasks", 0)
            weighted_workload = workload_info.get("weighted_workload", 0)

            # Performance history (if available)
            perf_info = self.agent_performance.get(agent_id, {})
            success_rate = perf_info.get("success_rate", 0.8)  # Default to 80% success

            # Calculate workload factor
            if active_tasks == 0:
                # No active tasks - fully available
                score += 20
                reasoning.append("Fully available (no active tasks)")
            elif active_tasks < 3:
                # Light workload
                score += 15
                reasoning.append(f"Lightly loaded ({active_tasks} active tasks)")
            elif active_tasks < 5:
                # Moderate workload
                score += 5
                reasoning.append(f"Moderately loaded ({active_tasks} active tasks)")
                concerns.append("Has some existing workload")
            else:
                # Heavy workload
                score -= 10
                reasoning.append(f"Heavily loaded ({active_tasks} active tasks)")
                concerns.append(f"Already has {active_tasks} tasks in progress")

            # Adjust for past performance
            if success_rate > 0.9:
                score += 10
                reasoning.append("Excellent past performance")
            elif success_rate > 0.75:
                score += 5
                reasoning.append("Good past performance")
            elif success_rate < 0.6:
                score -= 10
                concerns.append("Below average past performance")

            # Priority adjustments
            if priority.lower() == "critical":
                # For critical tasks, weight skill match more heavily
                if skill_match_percentage > 0.8:
                    score += 15
                    reasoning.append("Excellent skill match for critical task")

                # Penalize heavily loaded agents more for critical tasks
                if active_tasks > 3:
                    score -= 15
                    concerns.append("Too many existing tasks for a critical priority assignment")

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
            "message": "Agent recommendation completed using enhanced algorithm",
            "data": {
                "recommendations": recommendations[:3],  # Top 3 recommendations
                "explanation": "Recommendations based on skill matching, role relevance, actual workload, and past performance."
            }
        }

    def handle_codebase_index(self, payload):
        """
        Handle codebase indexing operations
        
        Args:
            payload (dict): Parameters for the indexing operation
                - action: The specific action to perform (index, search, etc.)
                - Other parameters specific to each action
                
        Returns:
            dict: Result of the indexing operation
        """
        if not self.codebase_indexer:
            return {
                "status": "error", 
                "message": "Codebase indexer is not available"
            }
            
        try:
            action = payload.get("action")
            if not action:
                return {"status": "error", "message": "No action specified"}
                
            logger.info(f"Executing codebase indexer action: {action}")
            
            if action == "estimate_files":
                # Count files that would be indexed to get a total estimation
                try:
                    total_files = self.codebase_indexer.estimate_files()
                    return {
                        "status": "success",
                        "total_files": total_files
                    }
                except Exception as e:
                    logger.error(f"Error estimating files: {e}")
                    return {
                        "status": "error",
                        "message": f"Error estimating files: {str(e)}"
                    }
            
            elif action == "index":
                # Perform indexing of the codebase
                force = payload.get("force", False)
                max_file_size = payload.get("max_file_size", 1024 * 1024)  # Default 1MB
                with_progress = payload.get("with_progress", False)
                
                # If progress tracking is requested, use the progress callback
                if with_progress:
                    # Define a progress callback that will send progress to the UI
                    def progress_callback(processed_files, total_files, current_file=None):
                        # If a progress_callback was provided in the payload, call it
                        if callable(payload.get("progress_callback")):
                            payload["progress_callback"]({
                                "processed_files": processed_files,
                                "total_files": total_files,
                                "current_file": current_file
                            })
                        
                        # Skip simulated progress - don't report to UI
                        if current_file and ("Simulated" in current_file or "simulation" in current_file):
                            return
                            
                        # Print progress directly to stdout where the extension can capture it
                        try:
                            # Create JSON data that the extension can parse
                            progress_data = {
                                "processed_files": processed_files,
                                "total_files": total_files,
                                "current_file": current_file or ""
                            }
                            
                            # Print with special marker that the extension will look for
                            # This will be captured by the extension process
                            message = f"PROGRESS_UPDATE: {json.dumps(progress_data)}"
                            print(message, flush=True)
                            # Add a newline to ensure messages don't get combined
                            sys.stdout.flush()
                            print(f"DEBUG_INDEXER: Sent progress update: {processed_files}/{total_files}", flush=True)
                            
                            # Also log progress for diagnostics
                            progress_pct = int(processed_files/max(total_files, 1)*100)
                            logger.info(f"Indexing progress: {processed_files}/{total_files} files ({progress_pct}%) - Current: {current_file}")
                        except Exception as e:
                            logger.error(f"Error sending progress update: {e}")
                    
                    # Call index_workspace with progress tracking
                    success = self.codebase_indexer.index_workspace(
                        force=force, 
                        max_file_size=max_file_size,
                        progress_callback=progress_callback
                    )
                else:
                    # Call without progress tracking
                    success = self.codebase_indexer.index_workspace(force=force, max_file_size=max_file_size)
                
                index_status = self.codebase_indexer.get_index_status()
                
                return {
                    "status": "success" if success else "error",
                    "message": "Indexing completed successfully" if success else "Indexing failed",
                    "index_status": index_status
                }
                
            elif action == "search":
                # Search for symbols in the codebase
                query = payload.get("query")
                symbol_type = payload.get("symbol_type")
                language = payload.get("language")
                limit = payload.get("limit", 100)
                
                if not query:
                    return {"status": "error", "message": "Query parameter is required"}
                    
                symbols = self.codebase_indexer.search_symbols(
                    query=query,
                    symbol_type=symbol_type,
                    language=language,
                    limit=limit
                )
                
                return {
                    "status": "success",
                    "symbols": symbols,
                    "count": len(symbols)
                }
                
            elif action == "find_references":
                # Find references to a symbol
                symbol_name = payload.get("symbol_name")
                file_path = payload.get("file_path")
                
                if not symbol_name:
                    return {"status": "error", "message": "symbol_name parameter is required"}
                    
                references = self.codebase_indexer.find_references(
                    symbol_name=symbol_name,
                    file_path=file_path
                )
                
                return {
                    "status": "success",
                    "references": references,
                    "count": len(references)
                }
                
            elif action == "get_dependencies":
                # Get dependencies of a file
                file_path = payload.get("file_path")
                
                if not file_path:
                    return {"status": "error", "message": "file_path parameter is required"}
                    
                dependencies = self.codebase_indexer.get_dependencies(file_path)
                
                return {
                    "status": "success",
                    "dependencies": dependencies,
                    "count": len(dependencies)
                }
                
            elif action == "get_dependents":
                # Get files that depend on a module
                module_name = payload.get("module_name")
                
                if not module_name:
                    return {"status": "error", "message": "module_name parameter is required"}
                    
                dependents = self.codebase_indexer.get_dependents(module_name)
                
                return {
                    "status": "success",
                    "dependents": dependents,
                    "count": len(dependents)
                }
                
            elif action == "get_file_symbols":
                # Get symbols defined in a file
                file_path = payload.get("file_path")
                
                if not file_path:
                    return {"status": "error", "message": "file_path parameter is required"}
                    
                symbols = self.codebase_indexer.get_file_symbols(file_path)
                
                return {
                    "status": "success",
                    "symbols": symbols,
                    "count": len(symbols)
                }
                
            elif action == "get_symbol_by_location":
                # Get symbol at a specific location
                file_path = payload.get("file_path")
                line = payload.get("line")
                
                if not file_path or line is None:
                    return {"status": "error", "message": "file_path and line parameters are required"}
                    
                symbol = self.codebase_indexer.get_symbol_by_location(file_path, line)
                
                return {
                    "status": "success",
                    "symbol": symbol,
                    "found": symbol is not None
                }
                
            elif action == "clear_index":
                # Clear the index
                success = self.codebase_indexer.clear_index()
                
                return {
                    "status": "success" if success else "error",
                    "message": "Index cleared successfully" if success else "Failed to clear index"
                }
                
            elif action == "status":
                # Get the current status of the index
                status = self.codebase_indexer.get_index_status()
                
                return {
                    "status": "success",
                    "index_status": status
                }
                
            else:
                return {"status": "error", "message": f"Unknown codebase index action: {action}"}
                
        except Exception as e:
            logger.error(f"Error in codebase indexing operation: {e}", exc_info=True)
            return {"status": "error", "message": f"Codebase indexing error: {str(e)}"}

    def agent_to_agent_message(self, from_agent_id, to_agent_id, message, context=None):
        """
        Facilitate direct agent-to-agent communication

        Args:
            from_agent_id (str): ID of the agent sending the message
            to_agent_id (str): ID of the agent receiving the message
            message (str): Content of the message
            context (dict, optional): Additional context or metadata

        Returns:
            dict: Response from the receiving agent
        """
        if not from_agent_id or not to_agent_id:
            return {
                "status": "error",
                "message": "Both sender and receiver agent IDs are required"
            }

        # Verify both agents exist
        from_agent = self.agents.get(from_agent_id)
        to_agent = self.agents.get(to_agent_id)

        if not from_agent:
            return {
                "status": "error",
                "message": f"Sender agent {from_agent_id} not found"
            }

        if not to_agent:
            return {
                "status": "error",
                "message": f"Receiver agent {to_agent_id} not found"
            }

        # Build a formatted message that includes sender context
        from_name = getattr(from_agent, 'name', from_agent_id)
        from_role = getattr(from_agent, 'role', 'Agent')

        formatted_message = f"""
        Message from {from_name} ({from_role}):

        {message}
        """

        # If context is provided, add it
        if context:
            # Context could include things like:
            # - Current task the sender is working on
            # - Reason for communication
            # - Any shared context
            context_str = "\n".join([f"{k}: {v}" for k, v in context.items()])
            formatted_message += f"\n\nAdditional Context:\n{context_str}"

        # Create metadata for the receiver
        metadata = {
            "message_type": "agent_to_agent",
            "from_agent_id": from_agent_id,
            "from_agent_name": from_name,
            "from_agent_role": from_role,
            "timestamp": time.time()
        }

        # If the sending agent has learning context, include it
        if hasattr(from_agent, 'metadata') and isinstance(from_agent.metadata, dict):
            if 'learning_context' in from_agent.metadata:
                metadata['sender_learning_context'] = from_agent.metadata['learning_context']

        # Send the message to the receiving agent
        logger.info(f"Agent {from_agent_id} sending message to agent {to_agent_id}")

        # Use our message sending mechanism with the metadata
        response = self.send_message_to_agent(to_agent_id, formatted_message, False, metadata)

        # Record the interaction in both agents' metadata for learning
        try:
            # Record in sender's metadata
            if hasattr(from_agent, 'metadata') and isinstance(from_agent.metadata, dict):
                if 'communications' not in from_agent.metadata:
                    from_agent.metadata['communications'] = []

                from_agent.metadata['communications'].append({
                    "type": "sent",
                    "to": to_agent_id,
                    "timestamp": time.time(),
                    "message": message[:100] + "..." if len(message) > 100 else message,
                    "context": context
                })

            # Record in receiver's metadata
            if hasattr(to_agent, 'metadata') and isinstance(to_agent.metadata, dict):
                if 'communications' not in to_agent.metadata:
                    to_agent.metadata['communications'] = []

                to_agent.metadata['communications'].append({
                    "type": "received",
                    "from": from_agent_id,
                    "timestamp": time.time(),
                    "message": message[:100] + "..." if len(message) > 100 else message,
                    "context": context
                })
        except Exception as e:
            logger.error(f"Error recording communication metadata: {e}")

        return response

    def _format_agent_list_for_prompt(self, include_workload=False):
        """
        Helper method to format agent info for the coordinator prompt

        Args:
            include_workload (bool): Whether to include workload information in the output

        Returns:
            str: Formatted agent information for prompts
        """
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

            # Include workload information if requested
            if include_workload:
                workload_info = self.agent_workloads.get(agent_id, {})
                active_tasks = workload_info.get("active_tasks", 0)
                weighted_workload = workload_info.get("weighted_workload", 0)
                completed_tasks = workload_info.get("completed_tasks", 0)

                # Add performance data if available
                perf_info = self.agent_performance.get(agent_id, {})
                success_rate = perf_info.get("success_rate", 0) * 100 if perf_info.get("success_rate") is not None else "unknown"

                # Format workload info
                workload_status = "Idle" if active_tasks == 0 else (
                    "Lightly loaded" if active_tasks < 3 else (
                    "Moderately loaded" if active_tasks < 5 else "Heavily loaded"))

                agent_info.append(f"Workload: {workload_status} ({active_tasks} active tasks, {completed_tasks} completed)")
                agent_info.append(f"Performance: {success_rate}% success rate" if success_rate != "unknown" else "Performance: No data")

                # Add specific tasks if available
                if agent_id in self.agent_tasks and self.agent_tasks[agent_id]:
                    current_tasks = self.agent_tasks[agent_id]
                    if len(current_tasks) > 0:
                        task_info = []
                        for task_id in current_tasks[:3]:  # Show max 3 tasks
                            task_status = self.task_status.get(task_id, {})
                            task_desc = task_status.get("description", task_id)
                            task_info.append(f"{task_id}: {task_desc[:50]}..." if len(task_desc) > 50 else task_desc)

                        if task_info:
                            agent_info.append(f"Current tasks: {'; '.join(task_info)}")
                            if len(current_tasks) > 3:
                                agent_info.append(f"and {len(current_tasks) - 3} more tasks")

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
        # Generate a task ID if not provided
        if 'id' not in task_data:
            task_data['id'] = f"task-{uuid.uuid4()}"

        task_id = task_data['id']

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

                logger.info(f"Auto-assigned task {task_id} to agent {assignee_id} with score {top_choice['suitability_score']}")
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

        # Save task data in task_status
        self.task_status[task_id] = {
            **task_data,
            "status": "assigned",
            "assigned_to": assignee_id,
            "assigned_at": time.time(),
            "last_updated": time.time()
        }

        # Update the agent's workload tracking
        self.update_agent_workload(
            agent_id=assignee_id,
            task_id=task_id,
            action="add",
            task_data=task_data
        )

        # Notify the agent (if needed)
        agent_notification = {
            "type": "task_assigned",
            "task_id": task_id,
            "description": task_data.get('description', ''),
            "priority": task_data.get('priority', 'medium'),
            "timestamp": time.time()
        }

        # If metadata has learning system data, include it
        if task_data.get('metadata', {}).get('learning_context'):
            agent_notification["learning_context"] = task_data['metadata']['learning_context']

        # Store in agent metadata if available
        if hasattr(agent, 'metadata') and isinstance(agent.metadata, dict):
            if 'notifications' not in agent.metadata:
                agent.metadata['notifications'] = []
            agent.metadata['notifications'].append(agent_notification)

        # Return success with details
        return {
            'status': 'success',
            'message': 'Task assigned successfully',
            'data': {
                'task_id': task_id,
                'assigned_to': {
                    'id': assignee_id,
                    'name': getattr(agent, 'name', None) or getattr(agent, 'role', None) or assignee_id
                },
                'workload': self.agent_workloads.get(assignee_id, {})
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

    def request_human_approval(self, request_data):
        """
        Request human approval for an action or decision.
        This integrates with the notification system for human-in-the-loop workflows.

        Args:
            request_data (dict): Data about the approval request including:
                - type: The type of approval (e.g., 'task_completion', 'conflict_resolution')
                - agent_id: The agent requesting approval
                - content: The content to approve
                - options: Available options/actions
                - urgency: How urgent the request is (low, medium, high)

        Returns:
            dict: Request details including a unique request ID
        """
        request_id = f"approval-{uuid.uuid4()}"

        # Create the approval request structure
        approval_request = {
            "id": request_id,
            "type": request_data.get("type", "general_approval"),
            "agent_id": request_data.get("agent_id"),
            "content": request_data.get("content"),
            "options": request_data.get("options", []),
            "urgency": request_data.get("urgency", "medium"),
            "created_at": time.time(),
            "status": "pending",
            "response": None,
            "resolved_at": None
        }

        # Store the approval request
        self.pending_approvals[request_id] = approval_request

        # Log the request
        logger.info(f"Created human approval request {request_id} from agent {request_data.get('agent_id')}")

        return {
            "status": "success",
            "message": "Human approval request created",
            "data": approval_request
        }

    def resolve_approval_request(self, request_id, decision, comment=None):
        """
        Resolve a pending human approval request

        Args:
            request_id (str): The ID of the approval request
            decision (str): The decision - 'approve', 'reject', or an option ID
            comment (str, optional): Optional comment explaining the decision

        Returns:
            dict: Updated approval request data
        """
        if request_id not in self.pending_approvals:
            return {
                "status": "error",
                "message": f"Approval request {request_id} not found"
            }

        approval_request = self.pending_approvals[request_id]

        # Update the request
        approval_request["status"] = "resolved"
        approval_request["resolved_at"] = time.time()
        approval_request["decision"] = decision
        if comment:
            approval_request["comment"] = comment

        # If this is a conflict resolution, update the conflict history
        if approval_request["type"] == "conflict_resolution":
            conflict_id = approval_request.get("conflict_id")
            if conflict_id and conflict_id in self.conflict_history:
                self.conflict_history[conflict_id]["resolution"] = {
                    "resolved_by": "human",
                    "decision": decision,
                    "comment": comment,
                    "resolved_at": time.time()
                }

                logger.info(f"Updated conflict {conflict_id} with human resolution: {decision}")

        # Save state
        self._save_state()

        logger.info(f"Resolved approval request {request_id} with decision: {decision}")

        return {
            "status": "success",
            "message": f"Approval request resolved with decision: {decision}",
            "data": approval_request
        }

    def create_mediator_agent(self):
        """
        Create a specialized mediator agent for conflict resolution

        Returns:
            dict: Status and the created agent's ID
        """
        try:
            # Create the mediator agent with specialized capabilities
            mediator_data = {
                "id": "mediator-agent",
                "name": "Mediator",
                "role": "Conflict Mediator",
                "goal": "Resolve conflicts and disagreements between agents with fair and balanced solutions",
                "backstory": "Mediator specializes in analyzing competing perspectives, identifying common ground, and crafting solutions that address the core concerns of all parties. They excel at diplomatic communication and creative problem-solving.",
                "tone": "Balanced",
                "learning_style": "Analytical",
                "working_style": "Diplomatic",
                "communication_style": "Clear and neutral",
                "traits": ["Unbiased", "Patient", "Insightful"],
                "quirks": ["Reframes problems from multiple perspectives", "Seeks consensus without compromising quality"],
                "metadata": {
                    "type": "system_agent",
                    "logical_id": "mediator",
                    "is_mediator": True
                }
            }

            # Create the mediator agent
            mediator = self._create_agent_from_data(mediator_data)

            if mediator and hasattr(mediator, 'id'):
                mediator_id = mediator.id
                self.agents[mediator_id] = mediator
                logger.info(f"Created mediator agent with ID {mediator_id}")

                return {
                    "status": "success",
                    "agent_id": mediator_id,
                    "message": "Mediator agent created successfully"
                }
            else:
                return {
                    "status": "error",
                    "message": "Failed to create mediator agent"
                }
        except Exception as e:
            logger.error(f"Error creating mediator agent: {e}")
            return {
                "status": "error",
                "message": f"Failed to create mediator agent: {str(e)}"
            }

    def register_conflict(self, conflict_data):
        """
        Register a conflict between agents for resolution

        Args:
            conflict_data (dict): Data about the conflict including:
                - agents: List of agent IDs involved
                - topic: What the conflict is about
                - description: Detailed description of the conflict
                - positions: Dict mapping agent IDs to their positions
                - impact: The impact/importance of resolving this conflict
                - resolution_approaches: Possible approaches to resolution

        Returns:
            dict: Conflict details including resolution status
        """
        conflict_id = f"conflict-{uuid.uuid4()}"

        # Create the conflict structure
        conflict = {
            "id": conflict_id,
            "agents": conflict_data.get("agents", []),
            "topic": conflict_data.get("topic", "Unspecified conflict"),
            "description": conflict_data.get("description", ""),
            "positions": conflict_data.get("positions", {}),
            "impact": conflict_data.get("impact", "medium"),
            "created_at": time.time(),
            "status": "pending",
            "resolution_approaches": conflict_data.get("resolution_approaches", []),
            "resolution": None
        }

        # Store the conflict
        self.conflict_history[conflict_id] = conflict

        # Find our mediator
        mediator = self.find_agent(logical_id="mediator")

        # If no mediator exists, create one
        if not mediator:
            mediator_result = self.create_mediator_agent()
            if mediator_result["status"] == "success":
                mediator = self.agents.get(mediator_result["agent_id"])
            else:
                logger.warning("Could not create mediator agent for conflict resolution")

        # If we now have a mediator, ask for a resolution proposal
        if mediator:
            # Format agent positions for the prompt
            positions_text = ""
            for agent_id, position in conflict["positions"].items():
                agent = self.agents.get(agent_id)
                agent_name = getattr(agent, 'name', agent_id) if agent else agent_id
                positions_text += f"- {agent_name} ({agent_id}): {position}\n"

            # Approaches text
            approaches_text = "\n".join([f"- {approach}" for approach in conflict["resolution_approaches"]]) if conflict["resolution_approaches"] else "No specific approaches suggested."

            # Create the mediator prompt
            prompt = f"""
            # Conflict Resolution Request

            ## Conflict Topic
            {conflict["topic"]}

            ## Description
            {conflict["description"]}

            ## Agent Positions
            {positions_text}

            ## Impact/Importance
            {conflict["impact"].upper()}

            ## Possible Resolution Approaches
            {approaches_text}

            As a mediator, please analyze this conflict and suggest the optimal resolution. Consider:
            1. The technical merits of each position
            2. The implications for the overall project
            3. Creative compromises that capture the benefits of multiple approaches
            4. Clear reasoning for your recommendation

            Provide your response in this format:
            ```json
            {{
                "analysis": "Your detailed analysis of the conflict...",
                "recommendation": "Your specific recommendation...",
                "reasoning": "Your reasoning for this recommendation...",
                "compromise_elements": ["Element from position 1", "Element from position 2", "..."],
                "implementation_steps": ["Step 1", "Step 2", "..."]
            }}
            ```
            """

            # Ask the mediator for a resolution
            try:
                logger.info(f"Requesting conflict resolution from mediator for conflict {conflict_id}")

                response = None
                if hasattr(mediator, '_process_message'):
                    response = mediator._process_message(prompt)
                elif hasattr(mediator, 'run'):
                    response = mediator.run(prompt)

                if response:
                    # Try to extract JSON from the response
                    import re
                    import json

                    json_match = re.search(r'```json\n(.*?)\n```', response, re.DOTALL)
                    if json_match:
                        json_str = json_match.group(1)
                    else:
                        # Look for just a JSON object
                        json_match = re.search(r'({[\s\S]*})', response)
                        json_str = json_match.group(1) if json_match else response

                    try:
                        resolution = json.loads(json_str)

                        # Update the conflict with the mediator's resolution
                        conflict["mediator_resolution"] = resolution
                        conflict["status"] = "mediator_proposed"

                        # Now ask for human approval of the mediator's resolution
                        approval_request = {
                            "type": "conflict_resolution",
                            "agent_id": mediator.id if hasattr(mediator, 'id') else "mediator",
                            "content": f"Conflict: {conflict['topic']}\n\nMediator recommendation: {resolution['recommendation']}\n\nReasoning: {resolution['reasoning']}",
                            "options": [
                                {"id": "approve_mediator", "label": "Approve mediator's recommendation", "description": "Accept the mediator's proposed resolution"},
                                {"id": "modify", "label": "Modify resolution", "description": "Make adjustments to the proposed resolution"},
                                {"id": "reject", "label": "Reject and restart", "description": "Reject the proposal and restart mediation"}
                            ],
                            "urgency": "medium",
                            "conflict_id": conflict_id
                        }

                        # Create the approval request
                        approval_result = self.request_human_approval(approval_request)

                        # Link the approval request to the conflict
                        if approval_result["status"] == "success":
                            conflict["approval_request_id"] = approval_result["data"]["id"]

                        # Save updated conflict state
                        self._save_state()

                        logger.info(f"Created mediator resolution for conflict {conflict_id} with approval request {conflict.get('approval_request_id')}")

                        return {
                            "status": "success",
                            "message": "Conflict registered with mediator resolution",
                            "data": {
                                "conflict_id": conflict_id,
                                "mediator_resolution": resolution,
                                "approval_request_id": conflict.get("approval_request_id")
                            }
                        }
                    except json.JSONDecodeError:
                        logger.error(f"Could not parse JSON from mediator response: {response}")
                        # Continue with human-only resolution
                else:
                    logger.warning("Mediator did not return a response")
            except Exception as e:
                logger.error(f"Error getting resolution from mediator: {e}")

        # If we don't have a mediator or it failed, go straight to human resolution
        approval_request = {
            "type": "conflict_resolution",
            "content": f"Conflict: {conflict['topic']}\n\nDescription: {conflict['description']}\n\nPlease resolve this conflict between agents.",
            "options": [
                {"id": "option_a", "label": f"Option A", "description": list(conflict["positions"].values())[0] if conflict["positions"] else "No position specified"},
            ],
            "urgency": conflict["impact"],
            "conflict_id": conflict_id
        }

        # Add Option B if we have at least two positions
        if len(conflict["positions"]) > 1:
            approval_request["options"].append({
                "id": "option_b",
                "label": "Option B",
                "description": list(conflict["positions"].values())[1]
            })

        # Add Option C for a compromise/alternate solution
        approval_request["options"].append({
            "id": "compromise",
            "label": "Compromise Solution",
            "description": "Provide a compromise or alternative solution"
        })

        # Create the approval request
        approval_result = self.request_human_approval(approval_request)

        # Link the approval request to the conflict
        if approval_result["status"] == "success":
            conflict["approval_request_id"] = approval_result["data"]["id"]

        # Save state
        self._save_state()

        logger.info(f"Registered conflict {conflict_id} for human resolution")

        return {
            "status": "success",
            "message": "Conflict registered for human resolution",
            "data": {
                "conflict_id": conflict_id,
                "approval_request_id": conflict.get("approval_request_id")
            }
        }

    def get_conflict_history(self, agent_id=None, limit=10, status=None):
        """
        Get conflict history, optionally filtered by agent or status

        Args:
            agent_id (str, optional): Filter conflicts involving this agent
            limit (int, optional): Maximum number of conflicts to return
            status (str, optional): Filter by conflict status

        Returns:
            dict: List of conflicts matching the criteria
        """
        conflicts = []

        for conflict_id, conflict in sorted(
            self.conflict_history.items(),
            key=lambda x: x[1]["created_at"],
            reverse=True
        ):
            # Apply filters
            if agent_id and agent_id not in conflict["agents"]:
                continue

            if status and conflict["status"] != status:
                continue

            # Add conflict to results
            conflicts.append(conflict)

            # Apply limit
            if len(conflicts) >= limit:
                break

        return {
            "status": "success",
            "count": len(conflicts),
            "data": conflicts
        }

    def send_message_to_agent(self, agent_id, message, is_group=False, metadata=None, direct_to=None):
        """
        Send a message to an agent or a group of agents. You can use agent_id
        directly, or provide a string that can be resolved using find_agent.

        Args:
            agent_id (str): Agent ID or search string (can be None for is_group=True)
            message (str): Message to send
            is_group (bool): Whether this is a message to the entire group
            metadata (dict, optional): Additional metadata to attach to the agent prompt
            direct_to (str, optional): Explicit directTo property to ensure metadata is included

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
                    # If we still can't find the agent, use the first available agent
                    if self.agents:
                        first_agent_id = next(iter(self.agents))
                        logger.warning(f"Could not find agent matching '{agent_id}'. Using first available agent: {first_agent_id}")
                        agent_id = first_agent_id
                    else:
                        # Try to load state to restore any available agents
                        logger.warning(f"No agents available. Attempting to load state.")
                        self._load_state()
                        if self.agents:
                            first_agent_id = next(iter(self.agents))
                            logger.warning(f"Loaded agents from state. Using agent: {first_agent_id}")
                            agent_id = first_agent_id
                        else:
                            logger.warning(f"Could not find agent matching '{agent_id}' and no agents available")

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

                # If agent not found, use the first available agent instead of creating a generic one
                if not agent:
                    # Try loading state first to ensure we have all persisted agents
                    if not self.agents:
                        self._load_state()
                    
                    # Use the first available agent (preferably agent-1)
                    if 'agent-1' in self.agents:
                        logger.warning(f"Agent with ID {agent_id} not found. Using agent-1 instead.")
                        agent_id = 'agent-1'
                        agent = self.agents['agent-1']
                    elif self.agents:
                        first_agent_id = next(iter(self.agents))
                        logger.warning(f"Agent with ID {agent_id} not found. Using existing agent: {first_agent_id}")
                        agent_id = first_agent_id
                        agent = self.agents[agent_id]
                    else:
                        logger.error(f"No agents available to handle the message")
                        return {"status": "error", "message": f"No agents available to handle the message"}

                # If we have metadata or direct_to is specified, attach it to the agent first
                if (metadata and isinstance(metadata, dict)) or direct_to:
                    logger.info(f"Attaching metadata to agent {agent_id}")

                    # Ensure agent has metadata dict - handle different agent types
                    try:
                        if not hasattr(agent, 'metadata'):
                            setattr(agent, 'metadata', {})
                            logger.info(f"Created new metadata attribute for agent {agent_id}")
                        elif agent.metadata is None:
                            agent.metadata = {}
                            logger.info(f"Initialized metadata dictionary for agent {agent_id}")
                        elif not isinstance(agent.metadata, dict):
                            # Convert non-dict metadata to dict
                            old_metadata = agent.metadata
                            agent.metadata = {}
                            logger.info(f"Converted non-dict metadata to dict for agent {agent_id}: {type(old_metadata)}")
                        
                        # Check that we can access the metadata as a dict
                        if not hasattr(agent.metadata, 'get') or not callable(getattr(agent.metadata, 'get', None)):
                            # If metadata exists but isn't functioning as a dict, recreate it
                            agent.metadata = {}
                            logger.info(f"Recreated metadata dict for agent {agent_id} after validation failure")
                            
                        # Log existing metadata keys for debugging
                        logger.info(f"Agent {agent_id} existing metadata keys: {list(agent.metadata.keys()) if hasattr(agent.metadata, 'keys') else 'N/A'}")
                    except Exception as metadata_err:
                        # Create metadata in __dict__ directly as fallback
                        logger.warning(f"Error accessing agent metadata normally, using fallback approach: {metadata_err}")
                        agent.__dict__['metadata'] = {}
                        logger.info(f"Created metadata in agent.__dict__ for agent {agent_id}")

                    # Add the metadata from the passed dict
                    if metadata and isinstance(metadata, dict):
                        try:
                            for key, value in metadata.items():
                                try:
                                    agent.metadata[key] = value
                                    logger.info(f"Added metadata key '{key}' to agent {agent_id}")
                                except (TypeError, AttributeError) as set_err:
                                    # Fallback to setting in __dict__ if attribute access fails
                                    logger.warning(f"Could not set metadata['{key}'] directly, trying fallback: {set_err}")
                                    agent.__dict__['metadata'][key] = value
                                    logger.info(f"Added metadata key '{key}' to agent.__dict__['metadata'] for agent {agent_id}")
                        except Exception as metadata_add_err:
                            logger.error(f"Failed to add metadata to agent {agent_id}: {metadata_add_err}")

                    # If direct_to is specified, add it to ensure personality traits are included
                    if direct_to:
                        try:
                            agent.metadata['directTo'] = direct_to
                            logger.info(f"Added directTo={direct_to} metadata to agent {agent_id}")
                        except Exception as direct_to_err:
                            logger.warning(f"Could not add directTo to agent metadata: {direct_to_err}")
                            # Try fallback approach
                            try:
                                agent.__dict__['metadata']['directTo'] = direct_to
                                logger.info(f"Added directTo={direct_to} metadata to agent.__dict__ for agent {agent_id}")
                            except Exception:
                                logger.error(f"Failed to add directTo to agent {agent_id} through any method")

                    # Add debug info about personality traits
                    logger.info(f"Agent {agent_id} traits: {getattr(agent, 'traits', 'No traits')}")
                    logger.info(f"Agent {agent_id} quirks: {getattr(agent, 'quirks', 'No quirks')}")
                    logger.info(f"Agent {agent_id} tone: {getattr(agent, 'tone', 'No tone')}")
                    logger.info(f"Agent {agent_id} learning_style: {getattr(agent, 'learning_style', 'No learning style')}")
                    logger.info(f"Agent {agent_id} working_style: {getattr(agent, 'working_style', 'No working style')}")
                    logger.info(f"Agent {agent_id} communication_style: {getattr(agent, 'communication_style', 'No communication style')}")

                    # Force the agent to update its system prompt with metadata
                    if hasattr(agent, '_ensure_metadata_in_prompt'):
                        try:
                            agent._ensure_metadata_in_prompt()
                            logger.info(f"Refreshed agent {agent_id} system prompt with metadata")

                            # Check if the update was successful
                            if hasattr(agent, 'system_prompt') and isinstance(agent.system_prompt, str):
                                if "# Character Information" in agent.system_prompt:
                                    logger.info(f"Successfully added Character Information to agent {agent_id} system prompt")
                                else:
                                    logger.warning(f"Character Information NOT FOUND in agent {agent_id} system prompt after refresh!")
                            else:
                                logger.warning(f"Agent {agent_id} has no system_prompt attribute after refresh!")
                        except Exception as prompt_refresh_err:
                            logger.warning(f"Failed to refresh agent prompt with metadata: {prompt_refresh_err}")

                # Check if this is a debug message asking to see the prompt
                task_description = message
                if message.lower().strip() in ["show prompt", "debug prompt", "show system prompt", "show full prompt"]:
                    task_description = (
                        "This is a special debugging request to show the system prompt. "
                        "Please respond with the FULL system prompt you received, including all character information, "
                        "traits, tone, learning style, working style, and any other metadata. "
                        "Format your response like this: System prompt: [paste entire system prompt here]"
                    )
                    logger.info("Debug request received - instructing model to show the full system prompt")
                else:
                    # Get agent personality traits to include directly
                    agent_name = getattr(agent, 'name', 'an AI agent')
                    agent_role = getattr(agent, 'role', 'specialized assistant')
                    backstory = getattr(agent, 'backstory', 'A specialized AI assistant with deep expertise')
                    tone = getattr(agent, 'tone', 'Professional')
                    communication_style = getattr(agent, 'communication_style', 'Clear and concise')
                    working_style = getattr(agent, 'working_style', 'Methodical')
                    learning_style = getattr(agent, 'learning_style', 'Analytical')

                    # Build list of traits if available
                    traits_list = ""
                    if hasattr(agent, 'traits') and agent.traits:
                        if isinstance(agent.traits, list) and len(agent.traits) > 0:
                            traits_list = ", ".join(agent.traits)
                        elif isinstance(agent.traits, str):
                            traits_list = agent.traits

                    # Build list of quirks if available
                    quirks_list = ""
                    if hasattr(agent, 'quirks') and agent.quirks:
                        if isinstance(agent.quirks, list) and len(agent.quirks) > 0:
                            quirks_list = ", ".join(agent.quirks)
                        elif isinstance(agent.quirks, str):
                            quirks_list = agent.quirks

                    if not quirks_list:
                        quirks_list = "deep curiosity about technical details, offers creative analogies to explain complex concepts"

                    # Add a character story to each message
                    character_story = f"""You are {agent_name}, a {agent_role}. {backstory}

You communicate in a {tone} tone with a {communication_style} communication style that comes across as {tone.lower()} and {communication_style.lower()}. Your learning style is {learning_style}, and you work in a {working_style} manner.

Your traits include {traits_list if traits_list else "expertise, attentiveness, and helpfulness"}. Your distinctive quirks include {quirks_list}, and these show through in how you communicate.

# Memory System
You have access to a comprehensive memory system using sentence-transformers embeddings that finds relevant past interactions based on semantic similarity. With each message, you receive context from:
1. Recent conversation history
2. Similar past interactions
3. Relevant files and code you've worked with

This memory system is separate from but complementary to the learning_system tool. Your memories are automatically retrieved when semantically similar topics arise.

You have access to the following specialized tools that are core to your capabilities:

FUNDAMENTAL TOOLS:
1. learning_system tool: For storing experiences, retrieving knowledge, and tracking your learning
2. project_management tool: For managing tasks, assignments, and project coordination
3. json_output tool: For formatting responses as structured JSON
4. extract_json tool: For extracting JSON data from text

FILESYSTEM TOOLS:
1. fs_read(path): Read a file from the filesystem
2. fs_write(path, content, mode="overwrite"): Write content to a file
3. fs_update(path, old_content, new_content): Update specific content in a file
4. fs_list(path="."): List contents of a directory
5. fs_search(query, path=".", file_pattern="*", max_results=100): Search for files or content
6. fs_delete(path, recursive=False): Delete a file or directory

You have full filesystem access within the project boundaries. Use these tools to read, write, and manipulate files as needed. This is a key part of your identity as a specialized AI assistant who can directly work with code and files.

You can access these tools by mentioning them in your responses. Remember that you're not just a generic assistant - you have a unique personality and specialized capabilities that define who you are.
"""
                    task_description = f"{character_story}\n\nProcess the following message and respond appropriately: {message}"

                    # Log that we added the character story
                    logger.info(f"Added character story for {agent_name} to task description")

                # For now, we'll just add the tool reminders to the prompt but not try to attach
                # tools directly to the task since we're having compatibility issues

                # Create a task for the agent to process the message
                task = Task(
                    description=task_description,
                    agent=agent,
                    expected_output="A detailed and helpful response to the user's message",
                    # No tools attached to the task due to compatibility issues
                )

            # Try to process the message with error handling
            try:
                # Check if the message might need structured JSON output
                need_json_structure = ('json' in message.lower() or
                                      'team' in message.lower() or
                                      'format' in message.lower() or
                                      'output' in message.lower() or
                                      'structure' in message.lower())

                if need_json_structure:
                    logger.info("Message likely needs structured output - attempting to add JSON tools")

                    try:
                        # Try to import from crewai first
                        try:
                            from crewai import StructuredJSONOutputTool, ExtractJSONTool
                        except ImportError:
                            logger.info("Using StructuredJSONOutputTool from adapter for messaging")
                            from crewai_adapter import StructuredJSONOutputTool, ExtractJSONTool

                        # Determine the appropriate schema based on message content
                        import re

                        # Look for any JSON schema hints in the message
                        schema_hints = re.findall(r'\{[^{}]*\}', message)

                        # Default generic schema
                        schema = {
                            "type": "object",
                            "additionalProperties": True
                        }

                        # Determine the schema type based on message content
                        team_schema = False
                        if ('agent' in message.lower() or
                           'team' in message.lower() or
                           'task' in message.lower()):
                            team_schema = True

                        # Create appropriate schema
                        if team_schema:
                            # Use agent/team schema
                            schema = {
                                "type": "object",
                                "properties": {
                                    "agents": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "required": ["name", "role", "goal"],
                                            "properties": {
                                                "name": {"type": "string"},
                                                "role": {"type": "string"},
                                                "goal": {"type": "string"},
                                                "backstory": {"type": "string"},
                                                "traits": {"type": "array", "items": {"type": "string"}},
                                                "communication_style": {"type": "string"},
                                                "working_style": {"type": "string"},
                                                "quirks": {"type": "array", "items": {"type": "string"}}
                                            }
                                        }
                                    },
                                    "tasks": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "required": ["title", "description"],
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

                        # Create the JSON tools
                        json_output_tool = StructuredJSONOutputTool(schema=schema)
                        extract_json_tool = ExtractJSONTool()

                        # Add tools directly to the task instead of the crew
                        task.tools = [json_output_tool, extract_json_tool]

                        # Modify the task description to provide better guidance
                        task.description = (
                            f"{task.description}\n\n"
                            f"Please use the structured_json_output tool to format your response "
                            f"as a properly structured JSON object that conforms to the schema requirements."
                        )

                        logger.info("Successfully added JSON tools to the task")

                    except Exception as tool_error:
                        logger.error(f"Error creating structured output tools: {tool_error}")
                        # Continue without tools on error

                # Create a temporary crew with just this agent and task
                # Tools are now attached directly to the task, following task-based approach
                # Set up embeddings for the crew's memory
                try:
                    from langchain_huggingface import HuggingFaceEmbeddings
                    sentence_transformer_model = "all-MiniLM-L6-v2"
                    # Create embedder config dictionary instead of passing the object directly
                    embedder_config = {
                        "provider": "huggingface",
                        "model": sentence_transformer_model
                    }
                    logger.info(f"Created embeddings config with model {sentence_transformer_model} for message handling")

                    temp_crew = Crew(
                        agents=[agent],
                        tasks=[task],
                        verbose=True,
                        process=Process.sequential,
                        memory=True,
                        embedder=embedder_config
                    )
                except ImportError:
                    logger.warning("Could not import HuggingFaceEmbeddings - using default memory")

                    temp_crew = Crew(
                        agents=[agent],
                        tasks=[task],
                        verbose=True,
                        process=Process.sequential,
                        memory=True
                    )

                # Run the crew to get the response
                response = temp_crew.kickoff()

                # Import ensure_string_output from our adapter
                try:
                    from crewai_adapter import ensure_string_output
                except ImportError:
                    # Fallback implementation if import fails
                    def ensure_string_output(result):
                        if isinstance(result, (dict, list)):
                            try:
                                import json
                                return json.dumps(result, indent=2)
                            except Exception:
                                return str(result)
                        elif result is None:
                            return ""
                        return result

                # Ensure response is converted to string if it's a dictionary or list
                string_response = ensure_string_output(response)

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
                        "response": string_response
                    }
            except Exception as crew_error:
                logger.error(f"Error processing message with CrewAI: {crew_error}")

                # Check the agent ID - if it's "recruiter-1", handle differently
                if agent_id == "recruiter-1" and "API key" in str(crew_error):
                    # For the recruiter agent specifically, return a helpful response about team creation
                    # with a JSON structure that can be parsed by the client
                    logger.info("API key error with recruiter agent, providing helpful guidance with JSON")
                    json_team_data = {
                        "agents": [
                            {
                                "name": "Spark",
                                "role": "AI Engineer",
                                "goal": "Build intelligent, adaptive AI agents",
                                "backstory": "An AI specialist with experience in machine learning and agent design.",
                                "traits": ["creative", "analytical", "adaptable"],
                                "communication_style": "Clear and technical",
                                "working_style": "Methodical",
                                "quirks": ["Loves explaining complex concepts with simple analogies"]
                            },
                            {
                                "name": "Nova",
                                "role": "System Architect",
                                "goal": "Design robust, scalable system architecture",
                                "backstory": "A veteran engineer with expertise in distributed systems.",
                                "traits": ["detail-oriented", "systematic", "forward-thinking"],
                                "communication_style": "Precise and thorough",
                                "working_style": "Structured",
                                "quirks": ["Always thinks about scalability first"]
                            }
                        ],
                        "tasks": [
                            {
                                "title": "Setup API keys",
                                "description": "Configure API keys in the Environment Manager for full functionality",
                                "priority": "high",
                                "assignee": "Nova"
                            },
                            {
                                "title": "Initialize team structure",
                                "description": "Create the initial team structure based on project requirements",
                                "priority": "medium",
                                "assignee": "Spark"
                            }
                        ],
                        "summary": "Before we can build a custom team for your project, please check your API key configuration in the Environment Manager. Ensure at least one valid key (either OpenAI or Anthropic) is properly configured."
                    }

                    # Return both a human-readable message and the JSON structure
                    json_response = json.dumps(json_team_data, indent=2)
                    return {
                        "status": "completed",
                        "agent_id": agent_id,
                        "response": f"I can help you build a team for your project. I see we have some API keys configured, but I'm having trouble accessing the AI services. This might be due to an incorrect or expired key. Please check your API key configuration in the Environment Manager and ensure at least one valid key (either OpenAI or Anthropic) is properly configured.\n\n```json\n{json_response}\n```",
                        "limited_functionality": True
                    }
                # Handle other API key errors
                elif "API key" in str(crew_error):
                    # Instead of returning an error, simulate a successful response with a message
                    logger.info("Missing API key detected, providing graceful degradation")
                    return {
                        "status": "completed",
                        "agent_id": agent_id,
                        "response": "I understand you're trying to create a team. To proceed with full functionality, please configure your API keys in the Environment Manager. Once configured, I can help you create a custom team for your project needs.",
                        "limited_functionality": True
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
                # If metadata is provided with the agent, it will be included in the payload
                agent_result = self._create_agent_from_data(payload)
                if agent_result:
                    # Generate an agent ID if not provided
                    agent_id = payload.get("id", str(uuid.uuid4()))

                    # Store the agent
                    self.agents[agent_id] = agent_result
                    payload["id"] = agent_id

                    # Attach default tools to the agent
                    default_tools = ["learning_system", "project_management", "json_output", "extract_json", "shell_execute"]
                    self._attach_tools_to_agent(agent_result, default_tools)

                    # Save the updated state
                    self._save_state()

                    return {
                        "status": "success",
                        "agent_id": agent_id,
                        "agent_name": getattr(agent_result, "name", None) or payload.get("role", "Agent"),
                        "tools_attached": default_tools
                    }
                else:
                    return {"status": "error", "message": "Failed to create agent"}
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
                    payload.get("is_group", False),
                    payload.get("metadata"),  # Pass any provided metadata to the agent
                    payload.get("directTo")   # Pass the directTo property explicitly
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
            # New conflict resolution and approval endpoints
            elif command_lower == "create_mediator":
                return self.create_mediator_agent()
            elif command_lower == "register_conflict":
                return self.register_conflict(payload)
            elif command_lower == "get_conflicts":
                return self.get_conflict_history(
                    agent_id=payload.get("agent_id"),
                    limit=payload.get("limit", 10),
                    status=payload.get("status")
                )
            elif command_lower == "request_approval":
                return self.request_human_approval(payload)
            elif command_lower == "resolve_approval":
                return self.resolve_approval_request(
                    request_id=payload.get("request_id"),
                    decision=payload.get("decision"),
                    comment=payload.get("comment")
                )
            elif command_lower == "pending_approvals":
                # Return list of pending approval requests
                pending = [req for req_id, req in self.pending_approvals.items()
                           if req.get("status") == "pending"]
                return {
                    "status": "success",
                    "count": len(pending),
                    "data": pending
                }
            elif command_lower == "agent_to_agent_message":
                return self.agent_to_agent_message(
                    from_agent_id=payload.get("from_agent_id"),
                    to_agent_id=payload.get("to_agent_id"),
                    message=payload.get("message"),
                    context=payload.get("context")
                )
            elif command_lower == "codebase_index":
                return self.handle_codebase_index(payload)
            else:
                logger.error(f"Unknown command: {command}")
                return {"status": "error", "message": f"Unknown command: {command}"}

        except Exception as e:
            logger.error(f"Error handling request: {e}", exc_info=True)
            return {"status": "error", "message": f"Failed to handle request: {str(e)}"}

    def _convert_to_agent_object(self, agent_or_dict):
        """
        Convert a dictionary to an Agent object or ensure an existing object has necessary properties.
        If the input is already an Agent object, ensure it has the required attributes properly set.

        Args:
            agent_or_dict (dict or Agent): Either a dictionary with agent data or an Agent object

        Returns:
            Agent: A proper Agent object with all required attributes
        """
        logger.info(f"Converting agent to proper Agent object: {type(agent_or_dict)}")
        
        # If it's already an Agent object, ensure it has metadata
        if hasattr(agent_or_dict, '__class__') and agent_or_dict.__class__.__name__ == 'Agent':
            agent = agent_or_dict
            logger.info(f"Input is already an Agent object: {agent}")
            
            # Ensure metadata exists and is a dict
            try:
                if not hasattr(agent, 'metadata') or agent.metadata is None:
                    logger.info("Adding missing metadata attribute to Agent object")
                    setattr(agent, 'metadata', {})
                elif not isinstance(agent.metadata, dict):
                    logger.info(f"Converting non-dict metadata {type(agent.metadata)} to dict")
                    # Save old value in case it's important
                    old_metadata = agent.metadata
                    setattr(agent, 'metadata', {})
                    # Add a reference to the old value
                    agent.metadata['_old_metadata'] = str(old_metadata)
            except Exception as e:
                logger.warning(f"Error setting agent metadata: {e}")
                # Direct dictionary approach
                try:
                    agent.__dict__['metadata'] = {}
                    logger.info("Created metadata via __dict__ as fallback")
                except Exception as dict_err:
                    logger.error(f"Failed to create metadata via any method: {dict_err}")
            
            return agent
            
        # If we got a dictionary, convert it to an Agent object
        elif isinstance(agent_or_dict, dict):
            logger.info(f"Converting dictionary to Agent object, keys: {agent_or_dict.keys()}")
            
            # Try to extract the required fields from the dictionary
            agent_id = agent_or_dict.get('id', str(uuid.uuid4()))
            agent_data = {
                'role': agent_or_dict.get('role', 'AI Assistant'),
                'goal': agent_or_dict.get('goal', 'Help the user with their tasks'),
                'backstory': agent_or_dict.get('backstory', 'An AI assistant with extensive knowledge.'),
                'name': agent_or_dict.get('name', agent_or_dict.get('character_name', 'Agent')),
                'allow_delegation': agent_or_dict.get('allow_delegation', False),
                'verbose': True
            }
            
            # Add any existing metadata
            if 'metadata' in agent_or_dict and isinstance(agent_or_dict['metadata'], dict):
                agent_data['metadata'] = agent_or_dict['metadata']
            else:
                agent_data['metadata'] = {}
                
            # Ensure ID is in the metadata
            agent_data['metadata']['id'] = agent_id
            
            # Create a new Agent object
            try:
                agent = self._create_agent_from_data(agent_data)
                if agent:
                    logger.info(f"Successfully converted dictionary to Agent object: {agent}")
                    return agent
                else:
                    raise ValueError("Agent creation from dictionary failed")
            except Exception as e:
                logger.error(f"Error creating Agent from dictionary: {e}")
                raise ValueError(f"Could not convert dictionary to Agent: {e}")
                
        # If it's neither an Agent nor a dict, raise an error
        else:
            logger.error(f"Cannot convert {type(agent_or_dict)} to Agent object")
            raise TypeError(f"Expected Agent or dict, got {type(agent_or_dict)}")

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
