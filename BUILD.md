# MightyDev Build System

This document explains how to build and develop the MightyDev VSCode extension.

## Prerequisites

- [Node.js](https://nodejs.org/) 16.x or later
- [npm](https://www.npmjs.com/) 8.x or later
- [Visual Studio Code](https://code.visualstudio.com/) 1.78.0 or later
- [Python](https://www.python.org/) 3.8 or later

## Build Scripts

MightyDev provides unified build scripts for both bash and PowerShell environments:

- `build.sh` - For Unix/Linux/macOS
- `build.ps1` - For Windows

### Build Options

Both scripts support the same options:

| Option | Bash | PowerShell | Description |
|--------|------|------------|-------------|
| Clean | `-c`, `--clean` | `-Clean` | Clean build outputs before building |
| Development | `-d`, `--dev` | `-Dev` | Start in development (watch) mode |
| Package | `-p`, `--package` | `-Package` | Build VSIX package |
| Help | `-h`, `--help` | `-Help` | Show help message |

## Basic Usage

### First-Time Setup

```bash
# Unix/Linux/macOS
./build.sh

# Windows
.\build.ps1
```

This will install all dependencies and build both the webview and extension.

### Development Mode

Start in development mode with file watching:

```bash
# Unix/Linux/macOS
./build.sh --dev

# Windows
.\build.ps1 -Dev
```

This will:
1. Watch the extension TypeScript files for changes
2. Watch the webview React files for changes
3. Automatically rebuild when files change

### Creating a VSIX Package

To create a VSIX package for distribution:

```bash
# Unix/Linux/macOS
./build.sh --package

# Windows
.\build.ps1 -Package
```

### Clean Build

To clean all build artifacts and start fresh:

```bash
# Unix/Linux/macOS
./build.sh --clean

# Windows
.\build.ps1 -Clean
```

## npm Scripts

You can also use the npm scripts directly:

| Script | Description |
|--------|-------------|
| `npm run setup` | Install all dependencies |
| `npm run build` | Build everything |
| `npm run dev` | Start development mode |
| `npm run clean` | Clean build outputs |
| `npm run rebuild` | Clean and rebuild everything |
| `npm run vsce-package` | Create VSIX package |

## Extension Structure

- `src/` - TypeScript source for the extension
- `webview/` - React-based webview UI
- `bundled/` - Python code and CrewAI integration
- `dist/` - Compiled extension output
- `webview/dist/` - Compiled webview output

## Troubleshooting

### Missing Dependencies

If you encounter errors about missing dependencies:

```bash
# Install extension dependencies
npm install

# Install webview dependencies
cd webview && npm install
```

### "Cannot find module" Errors

If you see "Cannot find module" errors after pulling changes:

```bash
# Rebuild everything
npm run rebuild
```

### Webview Not Loading

If the webview fails to load or appears blank:

1. Check the Developer Tools console for errors (`Help > Toggle Developer Tools`)
2. Make sure the webview has been built (`npm run build:webview`)
3. Verify that the webview script paths in `crewPanelProvider.ts` are correct