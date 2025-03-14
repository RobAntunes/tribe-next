import React, { useState, useEffect, useRef } from 'react';
import { getVsCodeApi } from '../../../../vscode';
import { Save, Plus, Trash2, Edit, RefreshCw, Info, AlertCircle, CheckCircle, Download, Upload, FileText, Settings, RotateCcw, AlertTriangle } from 'lucide-react';
import './styles.css';

// Initialize VS Code API
const vscode = getVsCodeApi();

interface EnvVariable {
  key: string;
  value: string;
  description?: string;
  isSecret?: boolean;
  isDisabled?: boolean;
}

interface EnvFile {
  path: string;
  exists: boolean;
  content?: string;
}

interface EnvironmentManagerProps {
  onSave?: (variables: EnvVariable[]) => void;
}

export const EnvironmentManager: React.FC<EnvironmentManagerProps> = ({ onSave }) => {
  const [variables, setVariables] = useState<EnvVariable[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [newVariable, setNewVariable] = useState<EnvVariable>({ key: '', value: '' });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [envFiles, setEnvFiles] = useState<EnvFile[]>([]);
  const [selectedEnvFile, setSelectedEnvFile] = useState<string>('');
  const [showResetDialog, setShowResetDialog] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Fetch environment variables when component mounts
  useEffect(() => {
    fetchEnvFiles();
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    
    // Request default env files when component mounts
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.getEnvFiles',
      payload: {}
    });
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Set up message listener for VS Code responses
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'COMMAND_RESULT':
          if (message.command === 'mightydev.getEnvFiles') {
            if (message.success && message.result) {
              setEnvFiles(message.result.envFiles || []);
              // Select first env file by default if available
              if (message.result.envFiles && message.result.envFiles.length > 0 && !selectedEnvFile) {
                setSelectedEnvFile(message.result.envFiles[0].path);
                loadEnvFileContent(message.result.envFiles[0].path);
              }
            } else {
              setError(message.error || 'Failed to get environment files');
              setTimeout(() => setError(null), 5000);
            }
          } else if (message.command === 'mightydev.getEnvVariables') {
            if (message.success && message.result) {
              setVariables(message.result.variables || []);
              setLoading(false);
            } else {
              setError(message.error || 'Failed to get environment variables');
              setTimeout(() => setError(null), 5000);
              setLoading(false);
            }
          } else if (message.command === 'mightydev.saveEnvFile') {
            if (message.success) {
              setSuccess('Environment variables saved successfully');
              setTimeout(() => setSuccess(null), 3000);
              fetchEnvFiles();
            } else {
              setError(message.error || 'Failed to save environment variables');
              setTimeout(() => setError(null), 5000);
            }
          }
          break;
        case 'ERROR':
          setError(message.payload.message);
          setTimeout(() => setError(null), 5000);
          setLoading(false);
          break;
      }
    };
    
    window.addEventListener('message', messageHandler);
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [selectedEnvFile]);

  const fetchEnvFiles = () => {
    setLoading(true);
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.getEnvFiles',
      payload: {}
    });
  };

  const loadEnvFileContent = (filePath: string) => {
    setLoading(true);
    setSelectedEnvFile(filePath);
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.getEnvVariables',
      payload: filePath
    });
  };

  const handleSaveChanges = () => {
    // Format variables into .env file content
    let content = '';
    
    // First, check which models are enabled/disabled by checking the radio selections
    const anthropicEnabled = variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value && !v.isDisabled);
    const openaiEnabled = variables.some(v => v.key === "OPENAI_API_KEY" && v.value && !v.isDisabled);
    
    // Add special disabled flags if needed to control model preference
    if (anthropicEnabled && variables.some(v => v.key === "OPENAI_API_KEY" && v.value)) {
      content += `# Disables OpenAI in favor of Anthropic Claude\n`;
      content += `OPENAI_API_KEY_DISABLED=true\n`;
    }
    
    if (openaiEnabled && variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value)) {
      content += `# Disables Anthropic Claude in favor of OpenAI\n`;
      content += `ANTHROPIC_API_KEY_DISABLED=true\n`;
    }
    
    // Add all other variables
    variables.filter(v => !v.isDisabled).forEach(v => {
      if (v.description) {
        // Add description as comment
        content += `# ${v.description}\n`;
      }
      content += `${v.key}=${v.value}\n`;
    });

    // Notify the extension to save the file - send a single object instead of array
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.saveEnvFile',
      payload: {
        filePath: selectedEnvFile || '.env',
        content: content
      }
    });
    
    // If onSave prop is provided, call it
    if (onSave) {
      onSave(variables);
    }
    
    setEditMode(false);
  };

  const handleCreateNewEnvFile = () => {
    // Show input dialog for filename
    vscode.postMessage({
      type: 'SHOW_INPUT_BOX',
      payload: {
        prompt: 'Enter path for new .env file',
        placeHolder: '.env.local',
        value: '.env'
      }
    });

    // The response will be handled by the message listener
    // which will then call fetchEnvFiles() to refresh the list
  };

  const handleAddVariable = () => {
    if (!newVariable.key || !newVariable.value) {
      setError('Both key and value are required');
      return;
    }
    
    // Check for duplicate keys
    if (variables.some(v => v.key === newVariable.key)) {
      setError('A variable with this key already exists');
      return;
    }
    
    setVariables([...variables, newVariable]);
    setNewVariable({ key: '', value: '' });
    setError(null);
  };

  const handleEditVariable = (index: number) => {
    setEditingIndex(index);
    setNewVariable({ ...variables[index] });
  };

  const handleUpdateVariable = () => {
    if (editingIndex === null) return;
    
    if (!newVariable.key || !newVariable.value) {
      setError('Both key and value are required');
      return;
    }
    
    // Check for duplicate keys, excluding the current one
    if (variables.some((v, i) => i !== editingIndex && v.key === newVariable.key)) {
      setError('A variable with this key already exists');
      return;
    }
    
    const updatedVariables = [...variables];
    updatedVariables[editingIndex] = newVariable;
    setVariables(updatedVariables);
    setEditingIndex(null);
    setNewVariable({ key: '', value: '' });
    setError(null);
  };

  const handleDeleteVariable = (index: number) => {
    const updatedVariables = [...variables];
    updatedVariables.splice(index, 1);
    setVariables(updatedVariables);
  };

  const handleToggleDisabled = (index: number) => {
    const updatedVariables = [...variables];
    updatedVariables[index].isDisabled = !updatedVariables[index].isDisabled;
    setVariables(updatedVariables);
  };

  const handleResetStorage = () => {
    vscode.postMessage({
      type: 'RESET_STORAGE'
    });
    setShowResetDialog(false);
  };

  const handleRestartExtension = () => {
    vscode.postMessage({
      type: 'RESTART_EXTENSION'
    });
    setShowSettingsMenu(false);
  };

  const renderEnvFilesDropdown = () => {
    return (
      <div className="env-file-selector">
        <div className="selector-label">
          <FileText size={16} />
          <span>Environment File:</span>
        </div>
        <div className="selector-control">
          <select 
            value={selectedEnvFile}
            onChange={(e) => loadEnvFileContent(e.target.value)}
            disabled={loading}
          >
            {envFiles.map((file, index) => (
              <option key={index} value={file.path}>
                {file.path} {!file.exists ? '(New)' : ''}
              </option>
            ))}
          </select>
          <button 
            className="create-file-button"
            onClick={handleCreateNewEnvFile}
            title="Create New .env File"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
    );
  };

  const renderVariableForm = () => {
    return (
      <div className="variable-form">
        <div className="form-row">
          <div className="form-group">
            <label>Key</label>
            <input
              type="text"
              value={newVariable.key}
              onChange={(e) => setNewVariable({ ...newVariable, key: e.target.value })}
              placeholder="Variable name"
              disabled={!editMode}
            />
          </div>
          <div className="form-group">
            <label>Value</label>
            <input
              type={newVariable.isSecret ? 'password' : 'text'}
              value={newVariable.value}
              onChange={(e) => setNewVariable({ ...newVariable, value: e.target.value })}
              placeholder="Variable value"
              disabled={!editMode}
            />
          </div>
          <div className="form-group form-group-small">
            <label>Secret</label>
            <input
              type="checkbox"
              checked={newVariable.isSecret || false}
              onChange={(e) => setNewVariable({ ...newVariable, isSecret: e.target.checked })}
              disabled={!editMode}
            />
          </div>
          <div className="form-actions">
            {editingIndex !== null ? (
              <button 
                className="update-button"
                onClick={handleUpdateVariable}
                disabled={!editMode}
              >
                Update
              </button>
            ) : (
              <button 
                className="add-button"
                onClick={handleAddVariable}
                disabled={!editMode || !newVariable.key || !newVariable.value}
              >
                <Plus size={16} />
                Add
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group full-width">
            <label>Description (optional)</label>
            <input
              type="text"
              value={newVariable.description || ''}
              onChange={(e) => setNewVariable({ ...newVariable, description: e.target.value })}
              placeholder="Brief description of this variable"
              disabled={!editMode}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderVariables = () => {
    if (variables.length === 0) {
      return (
        <div className="empty-state">
          <Info size={32} />
          <p>No environment variables found. Add some to get started.</p>
          {editMode && (
            <button className="add-first-button" onClick={() => setNewVariable({ key: '', value: '' })}>
              <Plus size={16} />
              Add First Variable
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="variables-list">
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Key</th>
              <th style={{ width: '40%' }}>Value</th>
              <th style={{ width: '20%' }}>Description</th>
              <th style={{ width: '10%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((variable, index) => (
              <tr key={index} className={variable.isDisabled ? 'disabled' : ''}>
                <td className="variable-key">{variable.key}</td>
                <td className="variable-value">
                  {variable.isSecret 
                    ? '••••••••••••••••'
                    : variable.value
                  }
                </td>
                <td className="variable-description">
                  {variable.description || '-'}
                </td>
                <td className="variable-actions">
                  {editMode && (
                    <>
                      <button 
                        className="action-button edit"
                        onClick={() => handleEditVariable(index)}
                        title="Edit"
                      >
                        <Edit size={16} />
                      </button>
                      <button 
                        className="action-button delete"
                        onClick={() => handleDeleteVariable(index)}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        className="action-button toggle"
                        onClick={() => handleToggleDisabled(index)}
                        title={variable.isDisabled ? "Enable" : "Disable"}
                      >
                        {variable.isDisabled ? "Enable" : "Disable"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderSettingsMenu = () => {
    if (!showSettingsMenu) return null;
    
    return (
      <div className="settings-dropdown" ref={settingsMenuRef}>
        <ul>
          <li onClick={handleRestartExtension}>
            <RotateCcw size={16} />
            Restart Extension
          </li>
          <li onClick={() => { setShowSettingsMenu(false); setShowResetDialog(true); }}>
            <Trash2 size={16} />
            Reset Storage
          </li>
          <li onClick={() => { setShowSettingsMenu(false); }}>
            <Upload size={16} />
            Import Environment
          </li>
          <li onClick={() => { setShowSettingsMenu(false); }}>
            <Download size={16} />
            Export Environment
          </li>
        </ul>
      </div>
    );
  };

  const renderResetDialog = () => {
    if (!showResetDialog) return null;
    
    return (
      <div className="reset-dialog-overlay">
        <div className="reset-dialog">
          <h3>Reset Storage</h3>
          <p>This will delete all stored data including teams, agents, and project configuration. This action cannot be undone.</p>
          <div className="dialog-actions">
            <button className="cancel-button" onClick={() => setShowResetDialog(false)}>
              Cancel
            </button>
            <button className="delete-button" onClick={handleResetStorage}>
              Reset Storage
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="environment-manager">
      <div className="env-header">
        <h3>Environment Variables</h3>
        <div className="header-actions">
          <button 
            className="refresh-button"
            onClick={fetchEnvFiles}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          
          <div className="settings-container">
            <button 
              className="settings-button"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              title="Settings"
            >
              <Settings size={16} />
              Settings
            </button>
            {renderSettingsMenu()}
          </div>
          
          {editMode ? (
            <>
              <button 
                className="cancel-button"
                onClick={() => {
                  setEditMode(false);
                  setEditingIndex(null);
                  setNewVariable({ key: '', value: '' });
                  // Reload original content
                  loadEnvFileContent(selectedEnvFile);
                }}
              >
                <X size={16} />
                Cancel
              </button>
              <button 
                className="save-button"
                onClick={handleSaveChanges}
              >
                <Save size={16} />
                Save
              </button>
            </>
          ) : (
            <button 
              className="edit-button"
              onClick={() => setEditMode(true)}
            >
              <Edit size={16} />
              Edit Variables
            </button>
          )}
        </div>
      </div>
      
      {/* Env file selector */}
      {renderEnvFilesDropdown()}
      
      {/* Status messages */}
      {error && (
        <div className="status-message error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      
      {success && (
        <div className="status-message success">
          <CheckCircle size={16} />
          {success}
        </div>
      )}
      
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading environment variables...</p>
        </div>
      ) : (
        <>
          {editMode && renderVariableForm()}
          {renderVariables()}
        </>
      )}
      
      <div className="model-toggle-container">
        <h4>Model Selection</h4>
        <div className="model-toggle">
          <div className="toggle-option">
            <input 
              type="radio" 
              id="model-anthropic" 
              name="model-preference"
              checked={variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value && !v.isDisabled)}
              onChange={() => {
                // Enable ANTHROPIC_API_KEY and make sure it has priority
                const updatedVars = variables.map(v => {
                  if (v.key === "ANTHROPIC_API_KEY") return { ...v, isDisabled: false };
                  return v;
                });
                setVariables(updatedVars);
              }}
              disabled={!variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value)}
            />
            <label htmlFor="model-anthropic">
              <strong>Claude (Anthropic)</strong>
              <span className="model-description">Best for complex reasoning and code generation</span>
              {!variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value) && 
                <span className="model-warning"><AlertTriangle size={12} /> Missing API key</span>}
            </label>
          </div>
          
          <div className="toggle-option">
            <input 
              type="radio" 
              id="model-openai" 
              name="model-preference"
              checked={variables.some(v => v.key === "OPENAI_API_KEY" && v.value && !v.isDisabled)}
              onChange={() => {
                // Enable OPENAI_API_KEY and make sure it has priority
                const updatedVars = variables.map(v => {
                  if (v.key === "OPENAI_API_KEY") return { ...v, isDisabled: false };
                  return v;
                });
                setVariables(updatedVars);
              }}
              disabled={!variables.some(v => v.key === "OPENAI_API_KEY" && v.value)}
            />
            <label htmlFor="model-openai">
              <strong>GPT-4 (OpenAI)</strong>
              <span className="model-description">Alternative AI model with strong capabilities</span>
              {!variables.some(v => v.key === "OPENAI_API_KEY" && v.value) && 
                <span className="model-warning"><AlertTriangle size={12} /> Missing API key</span>}
            </label>
          </div>
        </div>
        <p className="model-info">
          Add at least one API key above to enable model selection. If both API keys are provided, the selected model will be used.
        </p>
      </div>
      
      <div className="env-info">
        <h4>About Environment Variables</h4>
        <p>
          Environment variables are used to configure your extension. They are stored in a <code>.env</code> file
          and loaded when the extension starts. Changes to environment variables require a restart to take effect.
        </p>
        <p>
          <strong>Warning:</strong> Secret values like API keys should be kept confidential. The extension stores them
          securely, but be careful not to share them or commit them to version control.
        </p>
      </div>
      
      {/* Reset dialog */}
      {renderResetDialog()}
    </div>
  );
};

// Add utility component for X button
const X: React.FC<{ size: number }> = ({ size }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
};