// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as os from 'os';

const folderName = path.basename(__dirname);
export const EXTENSION_ROOT_DIR =
    folderName === 'common' ? path.dirname(path.dirname(__dirname)) : path.dirname(__dirname);
export const BUNDLED_PYTHON_SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, 'bundled');
export const SERVER_SCRIPT_PATH = path.join(BUNDLED_PYTHON_SCRIPTS_DIR, 'tool', `lsp_server.py`);
export const DEBUG_SERVER_SCRIPT_PATH = path.join(BUNDLED_PYTHON_SCRIPTS_DIR, 'tool', `_debug_server.py`);

// MightyDev Constants
export const EXTENSION_ID = 'mightydev';
export const EXTENSION_NAME = 'MightyDev';
export const TRIBE_FOLDER = '.tribe';
export const WEBVIEW_VIEWTYPE = 'mightydev.tribeView';
export const WEBVIEW_TITLE = 'Tribe Dashboard';
export const CREWAI_MAIN_SCRIPT = 'crewai_server.py';

// Custom virtual environment for CrewAI
export const CREWAI_VENV_DIR = path.join(EXTENSION_ROOT_DIR, 'crewai_venv');
export const CREWAI_VENV_PYTHON = os.platform() === 'win32'
    ? path.join(CREWAI_VENV_DIR, 'Scripts', 'python.exe')
    : path.join(CREWAI_VENV_DIR, 'bin', 'python');

// Commands
export const COMMAND_OPEN_TRIBE = 'mightydev.openTribe';
export const COMMAND_INITIALIZE_PROJECT = 'mightydev.initializeProject';
export const COMMAND_RESET_TRIBE = 'mightydev.resetTribe';
