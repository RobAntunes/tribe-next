import React, { useState, useEffect, useRef } from 'react';
import { getVsCodeApi } from '../../../../vscode';
import './styles.css';
import { Database, Search, RefreshCw, Code, Package, FileCode, Folder } from 'lucide-react';

// Initialize VS Code API
const vscode = getVsCodeApi();

interface Symbol {
  id: number;
  name: string;
  type: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature?: string;
  docstring?: string;
}

interface IndexStatus {
  last_indexed: number;
  file_count: number;
  symbol_count: number;
  indexing_in_progress: boolean;
}

// Create persistent local storage key for index status
const LOCAL_STORAGE_INDEX_STATUS_KEY = 'codebase_explorer_indexed_status';

export const CodebaseExplorer: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [symbolType, setSymbolType] = useState<string>('');
  const [language, setLanguage] = useState<string>('');
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [searchResults, setSearchResults] = useState<Symbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(100);
  const [currentFile, setCurrentFile] = useState<string>('');
  
  // Reference to store the progress interval
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Auto-indexing flag to prevent multiple triggers
  const autoIndexingRef = useRef(false);
  
  // Initialize with cached status if available, otherwise use default empty state
  useEffect(() => {
    try {
      // Try to load persisted status from localStorage first
      const persistedStatus = localStorage.getItem(LOCAL_STORAGE_INDEX_STATUS_KEY);
      if (persistedStatus) {
        const savedStatus = JSON.parse(persistedStatus);
        if (savedStatus && savedStatus.file_count > 0) {
          console.log("Loading cached index status:", savedStatus);
          setIndexStatus(savedStatus);
          autoIndexingRef.current = true; // Prevent auto-indexing since we have data
        }
      }
    } catch (error) {
      console.error("Error reading cached index status:", error);
    }
    
    // Get current status from server
    getIndexStatus();
  }, []);
  
  // Auto-indexing effect - separate from initialization
  useEffect(() => {
    // Only run this effect if we have a valid indexStatus from the server
    if (!indexStatus) return;
    
    // For first-time users, auto-trigger an index immediately
    // This makes the first run experience work properly
    const timer = setTimeout(() => {
      // Only attempt auto-indexing if we haven't done it yet and no index exists
      // Either indexStatus is null or both file_count and symbol_count are 0
      const needsIndexing = indexStatus.file_count === 0 && indexStatus.symbol_count === 0;
                           
      if (!autoIndexingRef.current && needsIndexing) {
        // Mark that we've attempted auto-indexing
        autoIndexingRef.current = true;
        console.log("Auto-starting initial indexing");
        
        // Set UI to indexing state before triggering the indexing
        setIsIndexing(true);
        setError(null);
        setIndexProgress(0);
        setCurrentFile("Starting initial indexing...");
        
        // Trigger actual indexing with a slight delay
        setTimeout(() => {
          startIndexing(false);
        }, 100);
      }
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [indexStatus]);
  
  // No need for periodic polling - once indexed, it stays indexed
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);
  
  // Listen for messages from extension
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      console.log('Received message:', message); // Debug logging
      
      if (message.type === 'CODEBASE_INDEX_STATUS') {
        console.log('Received index status:', message.payload);
        
        // Clear the status request flag when we get a response
        statusRequestInProgressRef.current = false;
        
        // Once we've done auto-indexing, we assume there's valid index data
        if (autoIndexingRef.current && !message.payload.file_count) {
          console.log('Got empty index status after auto-indexing, ignoring');
          return;
        }
        
        // If this is a valid status with data, persist it to localStorage
        if (message.payload && message.payload.file_count > 0) {
          try {
            localStorage.setItem(
              LOCAL_STORAGE_INDEX_STATUS_KEY, 
              JSON.stringify(message.payload)
            );
            console.log('Saved index status to local storage');
          } catch (error) {
            console.error('Error saving index status to localStorage:', error);
          }
        }
        
        // Update index status state with payload
        setIndexStatus(message.payload);
        
        // But only update isIndexing state if we're currently indexing and server says we're done
        // This helps prevent flashing between states during indexing process
        if (isIndexing && !message.payload.indexing_in_progress) {
          setIsIndexing(false);
        } else if (!isIndexing && message.payload.indexing_in_progress) {
          // Server says we're indexing but UI doesn't reflect it
          setIsIndexing(true);
        }
      }
      else if (message.type === 'CODEBASE_SEARCH_RESULTS') {
        setSearchResults(message.payload.symbols || []);
        setError(null);
      }
      else if (message.type === 'CODEBASE_INDEX_ERROR') {
        setError(message.payload.message);
        setIsIndexing(false);
        setIndexProgress(0);
        setCurrentFile('');
      }
      else if (message.type === 'CODEBASE_INDEX_PROGRESS') {
        console.log('Progress update:', message.payload); // Debug logging
        if (message.payload && typeof message.payload === 'object') {
          // Handle total files information
          if (message.payload.total_files && message.payload.total_files > 0) {
            setTotalFiles(message.payload.total_files);
          }
          
          // Handle progress information
          if (message.payload.processed_files !== undefined) {
            const processed = message.payload.processed_files;
            const total = message.payload.total_files || totalFiles || 100;
            // Calculate progress percentage and ensure it doesn't exceed 100%
            const progress = Math.min(Math.round((processed / total) * 100), 100);
            setIndexProgress(progress);
            
            // If we're at 100%, mark as completed and update status
            if (progress === 100) {
              // Clear the auto-indexing flag so we don't re-trigger
              autoIndexingRef.current = true;
              
              // Set completed status
              setCurrentFile("Indexing completed!");
              
              // Create a completed status manually - this ensures we show as indexed
              // even if the server response gets lost somehow
              const completedStatus: IndexStatus = {
                last_indexed: Date.now() / 1000, // Convert to seconds for consistency
                file_count: totalFiles,
                symbol_count: totalFiles, // Estimate, will be updated with real value
                indexing_in_progress: false
              };
              
              // Save this status to localStorage right away
              try {
                localStorage.setItem(
                  LOCAL_STORAGE_INDEX_STATUS_KEY, 
                  JSON.stringify(completedStatus)
                );
              } catch (error) {
                console.error('Error saving completed status:', error);
              }
              
              // Get status after a short delay
              setTimeout(() => {
                // This is critical - we need to force a final status update to get accurate counts
                // and to properly show the indexed state
                getIndexStatus();
                setIsIndexing(false);
                
                // We don't need multiple status checks - one is sufficient with our
                // localStorage persistence mechanism
              }, 1000);
            }
          }
          
          // Handle current file information
          if (message.payload.current_file) {
            setCurrentFile(message.payload.current_file);
          }
        }
      }
      else if (message.type === 'CODEBASE_ESTIMATE_FILES') {
        if (message.payload && message.payload.total_files) {
          setTotalFiles(message.payload.total_files);
        }
      }
    };
    
    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [totalFiles]);
  
  // Track if we're currently waiting for a status update to prevent duplicates
  const statusRequestInProgressRef = useRef(false);
  
  const getIndexStatus = () => {
    // Don't send multiple status requests simultaneously
    if (statusRequestInProgressRef.current) {
      console.log('Status request already in progress, skipping duplicate');
      return;
    }
    
    // Mark that a request is in progress
    statusRequestInProgressRef.current = true;
    
    // Send the request
    vscode.postMessage({
      type: 'EXECUTE_TOOL',
      payload: {
        toolName: 'codebase_index',
        params: {
          action: 'status'
        }
      }
    });
    
    // Auto-clear after a reasonable timeout in case no response comes
    setTimeout(() => {
      statusRequestInProgressRef.current = false;
    }, 2000);
  };
  
  const startIndexing = (force: boolean = false) => {
    // Don't reset progress state if we're already indexing (for auto-index)
    if (!isIndexing) {
      setIsIndexing(true);
      setError(null);
      setIndexProgress(0);
      
      // Only set empty current file if not already set (for auto-index case)
      if (!currentFile) {
        setCurrentFile('Preparing to index...');
      }
      
      setTotalFiles(100); // Default to 100
      
      // Update status
      if (indexStatus) {
        const updatedStatus = { ...indexStatus, indexing_in_progress: true };
        setIndexStatus(updatedStatus);
      }
      
      // Reset any existing interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    
    // First get an estimate of total files to index
    vscode.postMessage({
      type: 'EXECUTE_TOOL', 
      payload: {
        toolName: 'codebase_index',
        params: {
          action: 'estimate_files'
        }
      }
    });
    
    // Then start the actual indexing
    vscode.postMessage({
      type: 'EXECUTE_TOOL',
      payload: {
        toolName: 'codebase_index',
        params: {
          action: 'index',
          force: force,
          with_progress: true
        }
      }
    });
    
    // Set a timeout to refresh status if no completion message comes
    // This is a safety mechanism in case the indexing hangs or doesn't report completion
    setTimeout(() => {
      if (isIndexing) { // Only if we're still in indexing state
        console.log('Timeout reached - forcing status check');
        getIndexStatus();
        
        // If we're still in indexing state after a very long time, 
        // assume it completed and force state update
        setTimeout(() => {
          if (isIndexing) {
            console.log('Still indexing after timeout - forcing completion');
            setIsIndexing(false);
          }
        }, 5000);
      }
    }, 30000); // 30 second timeout
  };
  
  const searchSymbols = () => {
    if (!searchQuery) {
      setError('Please enter a search query');
      return;
    }
    
    setError(null);
    
    vscode.postMessage({
      type: 'EXECUTE_TOOL',
      payload: {
        toolName: 'codebase_index',
        params: {
          action: 'search',
          query: searchQuery,
          symbol_type: symbolType || undefined,
          language: language || undefined
        }
      }
    });
  };
  
  const openSymbol = (symbol: Symbol) => {
    vscode.postMessage({
      type: 'OPEN_FILE',
      payload: {
        filePath: symbol.file_path,
        lineNumber: symbol.line_start
      }
    });
    
    setSelectedSymbol(symbol);
  };
  
  const getSymbolIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'class':
        return <Package size={16} />;
      case 'function':
        return <FileCode size={16} />;
      case 'method':
        return <Code size={16} />;
      default:
        return <Code size={16} />;
    }
  };
  
  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
  };
  
  return (
    <div className="codebase-explorer">
      <div className="explorer-header">
        <div className="header-title">
          <Database size={20} />
          <h3>Codebase Explorer</h3>
        </div>
        
        <div className="index-status">
          {isIndexing ? (
            <div className="status-indicator indexing">
              <RefreshCw size={16} className="spin" />
              <div className="indexing-info">
                <div className="indexing-status">
                  <span>Indexing... {indexProgress > 0 ? `${indexProgress}%` : ''}</span>
                  {totalFiles > 0 && (
                    <span className="file-count">{indexProgress === 100 ? totalFiles : Math.floor(totalFiles * indexProgress / 100)} / {totalFiles} files</span>
                  )}
                </div>
                {currentFile && !currentFile.includes("Simulated") && (
                  <span className={`current-file ${currentFile.includes("completed") ? "completed" : ""}`} title={currentFile}>
                    {currentFile.includes("completed") ? "✓ " : "Current: "}{currentFile}
                  </span>
                )}
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar"
                    style={{ width: `${indexProgress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ) : indexStatus && indexStatus.file_count > 0 ? (
            <div className="status-indicator indexed">
              <span>
                {indexStatus.file_count} files, {indexStatus.symbol_count} symbols
              </span>
              <span className="last-indexed">
                Last indexed: {formatTimestamp(indexStatus.last_indexed)}
              </span>
            </div>
          ) : (
            <div className="status-indicator not-indexed">
              <span>Not indexed</span>
              <span className="last-indexed">Run indexer to enable code search</span>
            </div>
          )}
        </div>
      </div>
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      <div className="search-bar">
        <div className="search-input-container">
          <Search size={16} />
          <input 
            type="text" 
            placeholder="Search symbols (class, function, etc.)" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchSymbols();
            }}
          />
        </div>
        
        <div className="search-filters">
          <select 
            value={symbolType} 
            onChange={(e) => setSymbolType(e.target.value)}
            className="filter-select"
          >
            <option value="">All Types</option>
            <option value="class">Classes</option>
            <option value="function">Functions</option>
            <option value="method">Methods</option>
          </select>
          
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value)}
            className="filter-select"
          >
            <option value="">All Languages</option>
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
          </select>
          
          <button 
            className="search-button" 
            onClick={searchSymbols}
            disabled={isIndexing}
          >
            <Search size={16} />
            <span>Search</span>
          </button>
        </div>
      </div>
      
      <div className="actions-bar">
        <button 
          className="action-button" 
          onClick={() => startIndexing(false)}
          disabled={isIndexing}
        >
          <RefreshCw size={16} />
          <span>Update Index</span>
        </button>
        
        <button 
          className="action-button" 
          onClick={() => startIndexing(true)}
          disabled={isIndexing}
        >
          <RefreshCw size={16} />
          <span>Rebuild Index</span>
        </button>
      </div>
      
      <div className="search-results">
        <h4>Search Results ({searchResults.length})</h4>
        
        {searchResults.length > 0 ? (
          <ul className="symbols-list">
            {searchResults.map((symbol) => (
              <li 
                key={`${symbol.file_path}-${symbol.line_start}-${symbol.name}`}
                className={`symbol-item ${selectedSymbol === symbol ? 'selected' : ''}`}
                onClick={() => openSymbol(symbol)}
              >
                <div className="symbol-icon">
                  {getSymbolIcon(symbol.type)}
                </div>
                <div className="symbol-info">
                  <div className="symbol-name">
                    {symbol.name}
                    <span className="symbol-type">{symbol.type}</span>
                  </div>
                  <div className="symbol-path">
                    {symbol.file_path}:{symbol.line_start}
                  </div>
                  {symbol.signature && (
                    <div className="symbol-signature">
                      {symbol.signature}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <p>No symbols found. Try a different search query or index the codebase first.</p>
          </div>
        )}
      </div>
    </div>
  );
};