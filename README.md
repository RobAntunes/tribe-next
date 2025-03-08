# MightyDev: AI-Native IDE Extension with CrewAI

MightyDev is a VSCode extension that creates an AI-native IDE powered by dynamic AI agents built with CrewAI.

## Features

- **AI-Powered Development Environment**: Use CrewAI to create a dynamic development environment with powerful AI agents
- **Dynamic Agent System**: Agents can create additional agents, tasks, tools, and assign them to teams, crews, and workflows at runtime
- **Project Management System**: Coordinated project management with multiple task execution modes (synchronous, asynchronous, parallel, concurrent)
- **Learning System**: Three-part learning system leveraging CrewAI's memory capabilities: External Input, Reflection, and Feedback
- **Notification System**: Comprehensive notification system for user awareness and human-in-the-loop workflows
- **Code Generation & Editing**: AI-powered code generation with advanced diffing and code action capabilities

## Getting Started

1. Clone this repository
2. Run the setup script to install required dependencies:

```bash
cd /path/to/MightyDev/extensions/tribe
python setup.py
```

3. Build the extension:

```bash
npm install
npm run build
```

4. Press F5 in VS Code to start the extension in debug mode
5. Enter your project description in the Getting Started screen
6. Watch as MightyDev assembles a custom team of AI agents for your project

### API Keys

MightyDev requires at least one of the following API keys:
- **Anthropic API Key** (Recommended): Used for Claude models
- **OpenAI API Key** (Fallback): Used as a fallback if Anthropic is unavailable

The setup script will create a `.env` file where you can set your API keys.

## Requirements

- VSCode 1.78.0 or higher
- Python 3.8 or higher (Python 3.10+ recommended)
- NodeJS 16+ and npm

## Troubleshooting

If you encounter issues with the CrewAI server not starting:

1. Make sure you have API keys configured in your `.env` file
2. Check the logs in the Output panel (View > Output > MightyDev)
3. Try running the standalone server script:

```bash
cd /path/to/MightyDev/extensions/tribe
python start_crewai_server.py
```

If you're having library compatibility issues, you can manually set up the environment:

```bash
# Create a virtual environment
python -m venv crewai_venv

# Activate it
source crewai_venv/bin/activate  # On Windows: crewai_venv\Scripts\activate

# Install the dependencies
pip install uv
uv pip install --python $(which python) crewai pygls lsprotocol cattrs
```
- Python extension for VSCode

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `mightydev.pythonPath` | `[]` | Path to the Python executable for running CrewAI server and agents |
| `mightydev.defaultModelProvider` | `openai` | Default AI model provider for agents (`openai`, `anthropic`, `azure_openai`) |
| `mightydev.defaultModelName` | `gpt-4` | Default model to use for agents |
| `mightydev.showNotifications` | `onWarning` | Control when notifications are displayed (`off`, `onError`, `onWarning`, `always`) |
| `mightydev.humanInTheLoop` | `true` | Whether to require human confirmation for impactful tasks |
| `mightydev.logLevel` | `info` | Log level for MightyDev (`debug`, `info`, `warning`, `error`) |

## Commands

- **MightyDev: Open Tribe Dashboard** - Open the MightyDev Tribe dashboard
- **MightyDev: Initialize Project** - Initialize a new project with MightyDev
- **MightyDev: Reset Tribe** - Reset all MightyDev data for the current project

## Project Persistence

MightyDev stores project data in a `.tribe` folder in your project directory. This includes:
- Agent metadata
- Task information
- Project configuration
- Team structure
- Learning system data

## Agent System

Agents in MightyDev have unique personalities and characteristics:
- Character-like names (Sparks, Nova, Trinity, etc.)
- Detailed descriptions and metadata
- Unique stylistic properties (tone, learning style, working style, etc.)

## Development

### Setting up the development environment

MightyDev provides a unified build system for both the extension and webview. The easiest way to set up your development environment is to use our build scripts:

#### Using the build scripts (recommended)

```bash
# Unix/Linux/macOS
./build.sh

# Windows
.\build.ps1
```

This will install all dependencies and build both the extension and webview components.

For development mode with file watching:

```bash
# Unix/Linux/macOS
./build.sh --dev

# Windows
.\build.ps1 -Dev
```

See [BUILD.md](BUILD.md) for detailed build instructions and options.

#### Manual setup

If you prefer to set up manually:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run webview:install` to install webview dependencies
4. Run `npm run compile` to compile the extension

To run the extension in development mode:
1. Open the repository in VSCode
2. Press F5 to start debugging

### Building the extension

#### Using build scripts (recommended)

To build a VSIX package:

```bash
# Unix/Linux/macOS
./build.sh --package

# Windows
.\build.ps1 -Package
```

#### Manual build

To build a VSIX package manually:
1. Run `npm run vscode:prepublish` to prepare the extension
2. Run `npm run vsce-package` to create the VSIX file

## License

This project is licensed under the MIT License - see the LICENSE file for details.
