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
  
  // Use state instead of ref for selected model to ensure reactive updates
  const [selectedModel, setSelectedModel] = useState<'anthropic' | 'openai' | null>(null);
  
  // Single source of truth for component initialization
  const initializeComponent = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Step 1: Try to get the saved model preference from localStorage
      let modelPreference: 'anthropic' | 'openai' | null = null;
      try {
        const savedModel = localStorage.getItem('mightydev_selectedModel');
        if (savedModel === 'anthropic' || savedModel === 'openai') {
          modelPreference = savedModel;
          console.log('Loaded model preference from localStorage:', savedModel);
        }
      } catch (err) {
        console.error('Error reading from localStorage:', err);
      }
      
      // If no preference was found, default to Anthropic
      if (!modelPreference) {
        modelPreference = 'anthropic';
        console.log('No model preference found, defaulting to Anthropic');
        // Save the default to localStorage
        try {
          localStorage.setItem('mightydev_selectedModel', modelPreference);
        } catch (err) {
          console.error('Error saving to localStorage:', err);
        }
      }
      
      // Step 2: Set the initial model state
      setSelectedModel(modelPreference);
      
      // Step 3: Request environment files from the extension
      vscode.postMessage({
        type: 'COMMAND',
        command: 'mightydev.getEnvFiles',
        payload: {}
      });
      
      // The rest of the initialization will happen in the message handler
      // after we receive the environment files
    } catch (err) {
      console.error('Error during initialization:', err);
      setError('Failed to initialize the environment manager');
      setLoading(false);
    }
  };
  
  // Run initialization when component mounts
  useEffect(() => {
    initializeComponent();
    
    // Set up cleanup and event listeners
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    
    // Add a safety timeout to prevent stuck loading state
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn('Initial loading timeout reached, resetting loading state');
        setLoading(false);
      }
    }, 5000);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timeoutId);
    };
  }, []);

  // Complete rewrite of message handler to ensure consistent state
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'COMMAND_RESULT':
          if (message.command === 'mightydev.getEnvFiles') {
            // Reset loading state immediately for env files list
            setLoading(false);
            
            if (message.success && message.result) {
              const receivedFiles = message.result.envFiles || [];
              setEnvFiles(receivedFiles);
              
              // If we have files and no selection, select the first one
              if (receivedFiles.length > 0 && !selectedEnvFile) {
                const firstFilePath = receivedFiles[0].path;
                setSelectedEnvFile(firstFilePath);
                
                // Load variables from this file
                loadFileContent(firstFilePath);
              }
            } else {
              setError(message.error || 'Failed to get environment files');
              setTimeout(() => setError(null), 5000);
            }
          } else if (message.command === 'mightydev.getEnvVariables') {
            // Reset loading state for variables
            setLoading(false);
            
            if (message.success && message.result) {
              try {
                // Get raw variables first
                const rawVars = message.result.variables || [];
                console.log('Raw variables received:', rawVars);
                
                // Check if we already have API keys before updating
                const existingKeys = {
                  anthropic: variables.find(v => v.key === "ANTHROPIC_API_KEY"),
                  openai: variables.find(v => v.key === "OPENAI_API_KEY")
                };
                
                // First, process the data to completely clean it
                const processedVars = processLoadedVariables(rawVars);
                
                // Make sure API keys are preserved if we previously had them
                // This helps when reloading from possibly incomplete env files
                if (existingKeys.anthropic && !processedVars.some(v => v.key === "ANTHROPIC_API_KEY")) {
                  console.log('Restoring missing Anthropic key');
                  processedVars.push(existingKeys.anthropic);
                }
                
                if (existingKeys.openai && !processedVars.some(v => v.key === "OPENAI_API_KEY")) {
                  console.log('Restoring missing OpenAI key');
                  processedVars.push(existingKeys.openai);
                }
                
                // Final check
                console.log('Final processed variables:', processedVars);
                console.log('Has Anthropic key:', processedVars.some(v => v.key === "ANTHROPIC_API_KEY"));
                
                // Update state with processed variables
                setVariables(processedVars);
              } catch (err) {
                console.error('Failed to process variables:', err);
                setError('Error processing variables');
                setTimeout(() => setError(null), 5000);
                // Still set empty variables to avoid stuck state
                setVariables([]);
              }
            } else {
              setError(message.error || 'Failed to get environment variables');
              setTimeout(() => setError(null), 5000);
            }
          } else if (message.command === 'mightydev.saveEnvFile') {
            if (message.success) {
              setSuccess('Environment variables saved successfully');
              setTimeout(() => setSuccess(null), 3000);
              
              // Don't refresh after save - this was causing keys to disappear
              // The current state already contains our API keys
            } else {
              setError(message.error || 'Failed to save environment variables');
              setTimeout(() => setError(null), 5000);
            }
          }
          break;
        case 'ERROR':
          setError(message.payload?.message || 'An error occurred');
          setTimeout(() => setError(null), 5000);
          setLoading(false);
          break;
      }
    };
    
    window.addEventListener('message', messageHandler);
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [selectedEnvFile, selectedModel, variables]);
  
  // Process loaded variables in a consistent way
  const processLoadedVariables = (rawVars: EnvVariable[]): EnvVariable[] => {
    console.log('Processing loaded variables:', rawVars);
    
    // Step 1: Create a map of keys to filter duplicates immediately
    // Use aggressive deduplication that favors items that appear later in the array
    const uniqueKeyMap = new Map<string, number>();
    
    // First, record the position of each key (last occurrence wins)
    rawVars.forEach((v, index) => {
      if (v.key && v.key.trim() !== '') {
        uniqueKeyMap.set(v.key, index);
      }
    });
    
    // Then, create a filtered array that only contains the last occurrence of each key
    const uniqueVars = rawVars.filter((v, index) => 
      v.key && uniqueKeyMap.get(v.key) === index
    );
    
    // Step 2: Now apply our regular cleaning (removing disabled flags and empty values)
    const cleanVars = cleanEnvVariables(uniqueVars);
    
    // Step 3: Check which keys exist
    const hasAnthropic = cleanVars.some(v => v.key === "ANTHROPIC_API_KEY" && v.value);
    const hasOpenAI = cleanVars.some(v => v.key === "OPENAI_API_KEY" && v.value);
    
    // Check for explicit model provider setting
    const modelProviderVar = uniqueVars.find(v => v.key === "MODEL_PROVIDER");
    const explicitProvider = modelProviderVar?.value?.toLowerCase();
    
    // Step 4: Determine model selection with strong preference for Anthropic
    let modelToUse = selectedModel;
    
    // If an explicit MODEL_PROVIDER is set, honor that
    if (explicitProvider === 'anthropic' && hasAnthropic) {
      modelToUse = 'anthropic';
    } else if (explicitProvider === 'openai' && hasOpenAI) {
      modelToUse = 'openai';
    }
    // Otherwise use the selected model if it's available
    else if (selectedModel === 'anthropic' && hasAnthropic) {
      // Keep using Anthropic
    } else if (selectedModel === 'openai' && hasOpenAI) {
      // Keep using OpenAI
    } 
    // If selected model isn't available or no selection, make a default choice
    else {
      if (hasAnthropic) {
        // Prefer Anthropic if available, regardless of whether OpenAI is also available
        modelToUse = 'anthropic';
      } else if (hasOpenAI) {
        // Only use OpenAI if it's the only option
        modelToUse = 'openai';
      } else {
        // No model keys exist
        modelToUse = null;
      }
      
      // Update state and localStorage if we had to change the model
      if (modelToUse !== selectedModel) {
        setSelectedModel(modelToUse);
        saveModelToStorage(modelToUse);
      }
    }
    
    // Step 5: Apply model selection to variables
    const processed = applyModelSelection(cleanVars, modelToUse);
    
    // Step 6: Force a clean save to fix any issues in the file
    // This ensures the .env file is properly rewritten with no duplicates
    const shouldForceSave = rawVars.length !== cleanVars.length; // If we found duplicates
    
    // If we detected duplicates and we're not in edit mode, queue a save
    if (shouldForceSave && !editMode) {
      console.log('Duplicate keys detected, will force clean save later');
      
      // Small delay to ensure UI is updated first
      setTimeout(() => {
        // Generate clean content for the file
        const content = generateEnvFileContent(
          processed, 
          modelToUse === 'anthropic', 
          modelToUse === 'openai'
        );
        
        // Save the cleaned file
        vscode.postMessage({
          type: 'COMMAND',
          command: 'mightydev.saveEnvFile',
          payload: {
            filePath: selectedEnvFile || '.env',
            content: content
          }
        });
        
        setSuccess('Environment file cleaned automatically');
        setTimeout(() => setSuccess(null), 3000);
      }, 500);
    }
    
    // Return the processed variables (instead of setting them directly)
    return processed;
  };
  
  // Simplified function to load file content
  const loadFileContent = (filePath: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    // Update the selected file
    setSelectedEnvFile(filePath);
    
    // Request the variables from the extension
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.getEnvVariables',
      payload: filePath
    });
    
    // Set a safety timeout
    setTimeout(() => {
      if (loading) {
        console.warn('Load timeout reached, resetting loading state');
        setLoading(false);
      }
    }, 3000);
  };

  const handleSaveChanges = () => {
    console.log('Saving changes, current model:', selectedModel);
    
    // Keep track of both API keys before cleaning
    const originalAnthropicKey = variables.find(v => v.key === "ANTHROPIC_API_KEY");
    const originalOpenAIKey = variables.find(v => v.key === "OPENAI_API_KEY");
    
    console.log('Original Anthropic key:', originalAnthropicKey);
    console.log('Original OpenAI key:', originalOpenAIKey);
    
    // Step 1: Create a copy of variables, including any disabled ones
    let cleanedVars = [...variables].filter(v => 
      v.key.trim() !== '' && v.value !== undefined
    );
    
    // Step 2: Determine model selection
    let modelToUse = selectedModel;
    
    // If no model is selected but we have keys, pick a default
    if (!modelToUse) {
      const hasAnthropicKey = !!originalAnthropicKey?.value;
      const hasOpenAIKey = !!originalOpenAIKey?.value;
      
      if (hasAnthropicKey) {
        modelToUse = 'anthropic';
      } else if (hasOpenAIKey) {
        modelToUse = 'openai';
      }
      
      // Update state and localStorage
      if (modelToUse) {
        setSelectedModel(modelToUse);
        saveModelToStorage(modelToUse);
        console.log('No model selected, defaulting to:', modelToUse);
      }
    }
    
    // Step 3: Make a final variables array that explicitly includes both API keys
    // This new approach builds the array from scratch rather than modifying the existing one
    const finalVars: EnvVariable[] = [];
    
    // First, add all non-API key variables
    cleanedVars.filter(v => 
      v.key !== "ANTHROPIC_API_KEY" && 
      v.key !== "OPENAI_API_KEY" &&
      v.key !== "ANTHROPIC_API_KEY_DISABLED" &&
      v.key !== "OPENAI_API_KEY_DISABLED"
    ).forEach(v => {
      finalVars.push(v);
    });
    
    // Then explicitly add both API keys with the correct disabled status
    if (originalAnthropicKey && originalAnthropicKey.value) {
      finalVars.push({
        key: "ANTHROPIC_API_KEY",
        value: originalAnthropicKey.value,
        description: originalAnthropicKey.description || "Anthropic Claude API Key",
        isSecret: true,
        isDisabled: modelToUse === 'openai'
      });
      
      console.log('Adding Anthropic key to final vars');
    }
    
    if (originalOpenAIKey && originalOpenAIKey.value) {
      finalVars.push({
        key: "OPENAI_API_KEY",
        value: originalOpenAIKey.value,
        description: originalOpenAIKey.description || "OpenAI GPT API Key",
        isSecret: true,
        isDisabled: modelToUse === 'anthropic'
      });
      
      console.log('Adding OpenAI key to final vars');
    }
    
    console.log('Final variables count:', finalVars.length);
    console.log('Has Anthropic key:', finalVars.some(v => v.key === "ANTHROPIC_API_KEY"));
    
    // Step 4: Generate clean content for the .env file
    const content = generateEnvFileContent(
      finalVars, 
      modelToUse === 'anthropic', 
      modelToUse === 'openai'
    );
    
    // Step 5: Save the cleaned variables to state
    setVariables(finalVars);

    // Step 6: Notify the extension to save the file
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.saveEnvFile',
      payload: {
        filePath: selectedEnvFile || '.env',
        content: content
      }
    });
    
    // If onSave prop is provided, call it with the cleaned variables
    if (onSave) {
      onSave(finalVars);
    }
    
    // Exit edit mode
    setEditMode(false);
  };
  
  // Complete rewrite of file generation to ensure consistency
  const generateEnvFileContent = (vars: EnvVariable[], useAnthropic: boolean, useOpenAI: boolean): string => {
    // Create a completely fresh content string
    let content = '';
    
    // Get the keys that actually exist
    const hasAnthropicKey = vars.some(v => v.key === "ANTHROPIC_API_KEY" && v.value && v.key.trim() !== '');
    const hasOpenAIKey = vars.some(v => v.key === "OPENAI_API_KEY" && v.value && v.key.trim() !== '');
    
    // Generate header with version marker (helps track which version wrote the file)
    content += "# MightyDev Environment Variables\n";
    content += "# Version: 2.0.0\n";
    content += "# Last updated: " + new Date().toISOString() + "\n\n";
    
    // Note about API keys
    content += "# === API KEY CONFIGURATION ===\n";
    content += "# The extension requires at least one API key (OpenAI or Anthropic)\n";
    content += "# Add your API keys below\n\n";
    
    // Explicitly set the MODEL_PROVIDER - this is crucial for backend to use the right model
    if (hasAnthropicKey && useAnthropic) {
      content += "# Explicitly set model provider to ensure correct model is used\n";
      content += "MODEL_PROVIDER=anthropic\n\n";
      content += "# === MODEL SELECTION: ANTHROPIC CLAUDE ENABLED ===\n\n";
    } else if (hasOpenAIKey && useOpenAI) {
      content += "# Explicitly set model provider to ensure correct model is used\n";
      content += "MODEL_PROVIDER=openai\n\n";
      content += "# === MODEL SELECTION: OPENAI GPT ENABLED ===\n\n";
    } else if (hasAnthropicKey) {
      // Default to Anthropic if available and no explicit selection
      content += "# Explicitly set model provider to ensure correct model is used\n";
      content += "MODEL_PROVIDER=anthropic\n\n";
      content += "# === MODEL SELECTION: DEFAULTING TO ANTHROPIC CLAUDE ===\n\n";
    } else if (hasOpenAIKey) {
      // Default to OpenAI if that's all we have
      content += "# Explicitly set model provider to ensure correct model is used\n";
      content += "MODEL_PROVIDER=openai\n\n";
      content += "# === MODEL SELECTION: DEFAULTING TO OPENAI GPT ===\n\n";
    }
    
    // Always output both API keys if they exist
    if (hasAnthropicKey) {
      const anthropicVar = vars.find(v => v.key === "ANTHROPIC_API_KEY");
      if (anthropicVar) {
        if (anthropicVar.description) {
          content += `# ${anthropicVar.description}\n`;
        } else {
          content += `# Anthropic Claude API Key\n`;
        }
        // Only add _DISABLED suffix if the key is actually disabled
        if (anthropicVar.isDisabled) {
          content += `ANTHROPIC_API_KEY_DISABLED=${anthropicVar.value}\n\n`;
        } else {
          content += `ANTHROPIC_API_KEY=${anthropicVar.value}\n\n`;
        }
      }
    }
    
    if (hasOpenAIKey) {
      const openaiVar = vars.find(v => v.key === "OPENAI_API_KEY");
      if (openaiVar) {
        if (openaiVar.description) {
          content += `# ${openaiVar.description}\n`;
        } else {
          content += `# OpenAI GPT API Key\n`;
        }
        // Only add _DISABLED suffix if the key is actually disabled
        if (openaiVar.isDisabled) {
          content += `OPENAI_API_KEY_DISABLED=${openaiVar.value}\n\n`;
        } else {
          content += `OPENAI_API_KEY=${openaiVar.value}\n\n`;
        }
      }
    }
    
    // Add all other variables (excluding model keys and disabled flags)
    const otherVars = vars.filter(v => 
      v.key !== "ANTHROPIC_API_KEY" && 
      v.key !== "OPENAI_API_KEY" &&
      v.key !== "ANTHROPIC_API_KEY_DISABLED" &&
      v.key !== "OPENAI_API_KEY_DISABLED" &&
      v.key !== "MODEL_PROVIDER" &&  // Skip MODEL_PROVIDER as we handle it separately
      !v.isDisabled &&
      v.key.trim() !== ''
    );
    
    if (otherVars.length > 0) {
      content += "# === OTHER CONFIGURATION VARIABLES ===\n";
      
      otherVars.forEach(v => {
        if (v.description) {
          content += `# ${v.description}\n`;
        }
        content += `${v.key}=${v.value}\n`;
      });
    }
    
    return content;
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

  // Helper to add a missing API key
  const handleAddMissingKey = (keyType: 'anthropic' | 'openai') => {
    if (editMode) {
      if (keyType === 'anthropic') {
        setNewVariable({ 
          key: "ANTHROPIC_API_KEY", 
          value: "", 
          description: "Anthropic Claude API Key", 
          isSecret: true 
        });
      } else {
        setNewVariable({ 
          key: "OPENAI_API_KEY", 
          value: "", 
          description: "OpenAI GPT API Key", 
          isSecret: true 
        });
      }
    } else {
      // If not in edit mode, switch to it
      setEditMode(true);
      // Wait a bit for the UI to update before setting the variable
      setTimeout(() => {
        if (keyType === 'anthropic') {
          setNewVariable({ 
            key: "ANTHROPIC_API_KEY", 
            value: "", 
            description: "Anthropic Claude API Key", 
            isSecret: true 
          });
        } else {
          setNewVariable({ 
            key: "OPENAI_API_KEY", 
            value: "", 
            description: "OpenAI GPT API Key", 
            isSecret: true 
          });
        }
      }, 100);
    }
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
    // Save model selection to localStorage
    saveModelToStorage(selectedModel);
    
    // Get original API keys
    const originalAnthropicKey = variables.find(v => v.key === "ANTHROPIC_API_KEY");
    const originalOpenAIKey = variables.find(v => v.key === "OPENAI_API_KEY");
    
    // Create the final variables array with both API keys preserved
    const finalVars: EnvVariable[] = [];
    
    // Add all non-API key variables
    variables.filter(v => 
      v.key !== "ANTHROPIC_API_KEY" && 
      v.key !== "OPENAI_API_KEY" &&
      v.key !== "ANTHROPIC_API_KEY_DISABLED" &&
      v.key !== "OPENAI_API_KEY_DISABLED" &&
      v.key.trim() !== '' && 
      v.value !== undefined && 
      !v.isDisabled
    ).forEach(v => {
      finalVars.push(v);
    });
    
    // Then explicitly add both API keys with the correct disabled status
    if (originalAnthropicKey && originalAnthropicKey.value) {
      finalVars.push({
        key: "ANTHROPIC_API_KEY",
        value: originalAnthropicKey.value,
        description: originalAnthropicKey.description || "Anthropic Claude API Key",
        isSecret: true,
        isDisabled: selectedModel === 'openai'
      });
    }
    
    if (originalOpenAIKey && originalOpenAIKey.value) {
      finalVars.push({
        key: "OPENAI_API_KEY",
        value: originalOpenAIKey.value,
        description: originalOpenAIKey.description || "OpenAI GPT API Key",
        isSecret: true,
        isDisabled: selectedModel === 'anthropic'
      });
    }
    
    // Generate clean content for the .env file
    const content = generateEnvFileContent(
      finalVars, 
      selectedModel === 'anthropic', 
      selectedModel === 'openai'
    );
    
    // Save the file first
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.saveEnvFile',
      payload: {
        filePath: selectedEnvFile || '.env',
        content: content
      }
    });
    
    // Then request restart
    vscode.postMessage({
      type: 'RESTART_EXTENSION'
    });
    
    setShowSettingsMenu(false);
    
    // Show a success message
    setSuccess('Extension restart requested');
    setTimeout(() => setSuccess(null), 3000);
  };

  // Unified model selection handler
  const handleModelSelection = (model: 'anthropic' | 'openai') => {
    console.log(`Selecting model: ${model}`);
    
    // Update the state
    setSelectedModel(model);
    
    // Save to localStorage immediately
    saveModelToStorage(model);
    
    // Find both API keys in the current variables
    const anthropicKey = variables.find(v => v.key === "ANTHROPIC_API_KEY");
    const openaiKey = variables.find(v => v.key === "OPENAI_API_KEY");
    
    // Create a new array with updated disabled flags
    const updatedVars = variables.map(v => {
      if (v.key === "ANTHROPIC_API_KEY") {
        return { ...v, isDisabled: model === 'openai' };
      }
      if (v.key === "OPENAI_API_KEY") {
        return { ...v, isDisabled: model === 'anthropic' };
      }
      return v;
    });
    
    // Make sure we're not losing any keys during the update
    // If a key exists but wasn't in the original array, add it
    if (anthropicKey && !updatedVars.some(v => v.key === "ANTHROPIC_API_KEY")) {
      updatedVars.push({
        ...anthropicKey,
        isDisabled: model === 'openai'
      });
    }
    
    if (openaiKey && !updatedVars.some(v => v.key === "OPENAI_API_KEY")) {
      updatedVars.push({
        ...openaiKey,
        isDisabled: model === 'anthropic'
      });
    }
    
    // Update state with the new variables
    setVariables(updatedVars);
    
    // If we're not in edit mode, save the changes immediately
    if (!editMode) {
      const content = generateEnvFileContent(updatedVars, model === 'anthropic', model === 'openai');
      
      vscode.postMessage({
        type: 'COMMAND',
        command: 'mightydev.saveEnvFile',
        payload: {
          filePath: selectedEnvFile || '.env',
          content: content
        }
      });
    }
  };

  // Refresh environment files and variables
  const refreshEnvironmentFiles = () => {
    // Save model selection to localStorage first
    saveModelToStorage(selectedModel);
    
    // Reset states
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    // Request env files from the extension
    vscode.postMessage({
      type: 'COMMAND',
      command: 'mightydev.getEnvFiles',
      payload: {}
    });
    
    // Add a safety timeout to reset loading state if no response
    setTimeout(() => {
      if (loading) {
        console.warn('Fetch timeout reached, resetting loading state');
        setLoading(false);
      }
    }, 3000);
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
            onChange={(e) => loadFileContent(e.target.value)}
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

    // Make sure to show API keys even if they're disabled
    const displayVariables = variables.map(variable => {
      // Special handling for API keys - always show them even if disabled
      if (variable.key === "ANTHROPIC_API_KEY" || variable.key === "OPENAI_API_KEY") {
        return {
          ...variable,
          // Keep the isDisabled flag for styling, but don't exclude from display
          _showInList: true
        };
      }
      return variable;
    });

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
            {displayVariables.map((variable, index) => (
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

  const renderModelToggle = () => {
    // Check for actual API keys, regardless of disabled status
    const hasAnthropicKey = variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.value);
    const hasOpenAIKey = variables.some(v => v.key === "OPENAI_API_KEY" && v.value);
    
    return (
      <div className="model-toggle-container">
        <h4>Model Selection</h4>
        <div className="model-toggle">
          <div className="toggle-option">
            <input 
              type="radio" 
              id="model-anthropic" 
              name="model-preference"
              checked={selectedModel === 'anthropic' || (!selectedModel && hasAnthropicKey && !variables.some(v => v.key === "ANTHROPIC_API_KEY" && v.isDisabled))}
              onChange={() => handleModelSelection('anthropic')}
              disabled={!hasAnthropicKey}
            />
            <label htmlFor="model-anthropic">
              <strong>Claude (Anthropic)</strong>
              <span className="model-description">Best for complex reasoning and code generation</span>
              {!hasAnthropicKey ? (
                <div className="add-key-container">
                  <span className="model-warning"><AlertTriangle size={12} /> Missing API key</span>
                  {editMode && (
                    <button 
                      className="add-key-button"
                      onClick={() => handleAddMissingKey('anthropic')}
                    >
                      <Plus size={12} /> Add Key
                    </button>
                  )}
                </div>
              ) : null}
            </label>
          </div>
          
          <div className="toggle-option">
            <input 
              type="radio" 
              id="model-openai" 
              name="model-preference"
              checked={selectedModel === 'openai' || (!selectedModel && hasOpenAIKey && !variables.some(v => v.key === "OPENAI_API_KEY" && v.isDisabled))}
              onChange={() => handleModelSelection('openai')}
              disabled={!hasOpenAIKey}
            />
            <label htmlFor="model-openai">
              <strong>GPT-4 (OpenAI)</strong>
              <span className="model-description">Alternative AI model with strong capabilities</span>
              {!hasOpenAIKey ? (
                <div className="add-key-container">
                  <span className="model-warning"><AlertTriangle size={12} /> Missing API key</span>
                  {editMode && (
                    <button 
                      className="add-key-button"
                      onClick={() => handleAddMissingKey('openai')}
                    >
                      <Plus size={12} /> Add Key
                    </button>
                  )}
                </div>
              ) : null}
            </label>
          </div>
        </div>
        <p className="model-info">
          Add at least one API key above to enable model selection. 
          Both keys will be saved in your .env file, but only the selected model will be active.
        </p>
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
            onClick={refreshEnvironmentFiles}
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
                  // We won't reload content when canceling to avoid the spinner issue
                  // Just reset the loading state directly
                  setLoading(false);
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
              onClick={() => {
                // Make sure we're not in a loading state before enabling edit mode
                if (!loading) {
                  setEditMode(true);
                }
              }}
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
      
      {renderModelToggle()}
      
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

// Consolidated variable cleaning utility
const cleanEnvVariables = (vars: EnvVariable[]): EnvVariable[] => {
  // First collect all API keys so we can preserve them
  const anthropicKey = vars.find(v => v.key === "ANTHROPIC_API_KEY");
  const openaiKey = vars.find(v => v.key === "OPENAI_API_KEY");
  
  // Use an object to eliminate duplicates
  const uniqueVars: {[key: string]: EnvVariable} = {};
  
  // First, filter out any unnecessary flags and empty variables
  vars.filter(v => 
    // Keep all non-empty variables that aren't disabled
    v.key.trim() !== '' && 
    v.value !== undefined && 
    !v.isDisabled &&
    // Skip the _DISABLED suffix variables which we handle separately
    v.key !== "OPENAI_API_KEY_DISABLED" && 
    v.key !== "ANTHROPIC_API_KEY_DISABLED"
  ).forEach(v => {
    // Skip the API keys for now (we'll add them back later)
    if (v.key !== "ANTHROPIC_API_KEY" && v.key !== "OPENAI_API_KEY") {
      // This automatically keeps only the last occurrence of each key
      uniqueVars[v.key] = v;
    }
  });
  
  // Convert back to array
  const result = Object.values(uniqueVars);
  
  // Add back the API keys if they exist
  if (anthropicKey) {
    result.push(anthropicKey);
  }
  
  if (openaiKey) {
    result.push(openaiKey);
  }
  
  return result;
};

// Shared utility to update variables based on model selection
const applyModelSelection = (
  vars: EnvVariable[], 
  model: 'anthropic' | 'openai' | null
): EnvVariable[] => {
  if (!model) return vars;
  
  // Always keep both API keys in the env file, but mark the inactive one as disabled
  return vars.map(v => {
    if (v.key === "ANTHROPIC_API_KEY") {
      return { ...v, isDisabled: model === 'openai' };
    }
    if (v.key === "OPENAI_API_KEY") {
      return { ...v, isDisabled: model === 'anthropic' };
    }
    return v;
  });
};

// Save model preference to localStorage
const saveModelToStorage = (model: 'anthropic' | 'openai' | null) => {
  if (!model) return;
  
  try {
    localStorage.setItem('mightydev_selectedModel', model);
    console.log(`Saved ${model} selection to localStorage`);
  } catch (e) {
    console.error('Failed to save model selection to localStorage', e);
  }
};