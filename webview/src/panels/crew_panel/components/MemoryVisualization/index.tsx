import React, { useState, useEffect, useRef } from 'react';
import './styles.css';

interface Memory {
  id: string;
  content: string;
  source: string;
  timestamp: string;
  type: 'experience' | 'insight' | 'reflection' | 'feedback';
  tags: string[];
  relevance: number;
  connections: string[];
}

interface MemoryVisualizationProps {
  memories: Memory[];
  onMemorySelect?: (memory: Memory) => void;
  onContextUpdate?: (memoryIds: string[]) => void;
}

const MemoryVisualization: React.FC<MemoryVisualizationProps> = ({
  memories = [],
  onMemorySelect,
  onContextUpdate
}) => {
  const [selectedMemories, setSelectedMemories] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'network' | 'timeline' | 'clusters'>('network');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter memories based on search and type
  const filteredMemories = memories.filter(memory => {
    const matchesSearch = !filter || 
      memory.content.toLowerCase().includes(filter.toLowerCase()) ||
      memory.tags.some(tag => tag.toLowerCase().includes(filter.toLowerCase()));
    
    const matchesType = typeFilter === 'all' || memory.type === typeFilter;
    
    return matchesSearch && matchesType;
  });

  // Handle memory selection
  const toggleMemorySelection = (memoryId: string) => {
    setSelectedMemories(prev => {
      const isSelected = prev.includes(memoryId);
      const newSelection = isSelected 
        ? prev.filter(id => id !== memoryId)
        : [...prev, memoryId];
      
      // Call the context update callback if provided
      if (onContextUpdate) {
        onContextUpdate(newSelection);
      }
      
      return newSelection;
    });
  };

  // Network visualization rendering
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || viewMode !== 'network' || filteredMemories.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Resize canvas to container
    const resizeCanvas = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        canvas.width = width;
        canvas.height = height;
      }
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Define memory node properties
    const nodeRadius = 8;
    const selectedNodeRadius = 12;
    const typeColors = {
      'experience': '#3b82f6', // blue
      'insight': '#10b981',    // green
      'reflection': '#8b5cf6', // purple
      'feedback': '#f59e0b'    // amber
    };
    
    // Calculate positions - simple force-directed layout
    const nodes = filteredMemories.map((memory, index) => {
      // Simple circular layout for demo
      const angle = (index / filteredMemories.length) * Math.PI * 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.35;
      
      return {
        id: memory.id,
        x: canvas.width / 2 + Math.cos(angle) * radius,
        y: canvas.height / 2 + Math.sin(angle) * radius,
        type: memory.type,
        connections: memory.connections,
        isSelected: selectedMemories.includes(memory.id)
      };
    });
    
    // Draw connections first (so they appear behind nodes)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    
    nodes.forEach(node => {
      node.connections.forEach(connectionId => {
        const targetNode = nodes.find(n => n.id === connectionId);
        if (targetNode) {
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(targetNode.x, targetNode.y);
          
          // Highlight connections between selected memories
          if (node.isSelected && targetNode.isSelected) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
          }
          
          ctx.stroke();
        }
      });
    });
    
    // Draw nodes
    nodes.forEach(node => {
      const radius = node.isSelected ? selectedNodeRadius : nodeRadius;
      const color = typeColors[node.type as keyof typeof typeColors];
      
      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      
      // Selected node outline
      if (node.isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    
    // Add click handler for selecting nodes
    const handleCanvasClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Check if click is on a node
      for (const node of nodes) {
        const dx = node.x - x;
        const dy = node.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= (node.isSelected ? selectedNodeRadius : nodeRadius)) {
          // Find the memory and toggle selection
          const memory = filteredMemories.find(m => m.id === node.id);
          if (memory) {
            if (onMemorySelect) {
              onMemorySelect(memory);
            }
            toggleMemorySelection(node.id);
          }
          break;
        }
      }
    };
    
    canvas.addEventListener('click', handleCanvasClick);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, [filteredMemories, selectedMemories, viewMode, onMemorySelect]);

  return (
    <div className="memory-visualization-container">
      <div className="memory-visualization-controls">
        <div className="search-filter">
          <input
            type="text"
            placeholder="Search memories..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="tribe-input"
          />
          
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            className="tribe-input"
          >
            <option value="all">All Types</option>
            <option value="experience">Experiences</option>
            <option value="insight">Insights</option>
            <option value="reflection">Reflections</option>
            <option value="feedback">Feedback</option>
          </select>
        </div>
        
        <div className="view-mode-selector">
          <button 
            className={`tribe-button tribe-button-sm ${viewMode === 'network' ? 'tribe-button-primary' : 'tribe-button-secondary'}`}
            onClick={() => setViewMode('network')}
          >
            Network
          </button>
          <button 
            className={`tribe-button tribe-button-sm ${viewMode === 'timeline' ? 'tribe-button-primary' : 'tribe-button-secondary'}`}
            onClick={() => setViewMode('timeline')}
          >
            Timeline
          </button>
          <button 
            className={`tribe-button tribe-button-sm ${viewMode === 'clusters' ? 'tribe-button-primary' : 'tribe-button-secondary'}`}
            onClick={() => setViewMode('clusters')}
          >
            Clusters
          </button>
        </div>
      </div>
      
      <div className="memory-visualization-content">
        {viewMode === 'network' && (
          <div className="memory-network-view" ref={containerRef}>
            <canvas ref={canvasRef} className="memory-network-canvas" />
            {filteredMemories.length === 0 && (
              <div className="empty-state">
                <p>No memories to visualize</p>
                <button className="tribe-button tribe-button-primary">Add New Memory</button>
              </div>
            )}
          </div>
        )}
        
        {viewMode === 'timeline' && (
          <div className="memory-timeline-view">
            <div className="memory-timeline">
              {filteredMemories.length === 0 ? (
                <div className="empty-state">
                  <p>No memories to display on the timeline</p>
                </div>
              ) : (
                filteredMemories
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                  .map(memory => (
                    <div 
                      key={memory.id} 
                      className={`memory-timeline-item ${memory.type} ${selectedMemories.includes(memory.id) ? 'selected' : ''}`}
                      onClick={() => {
                        if (onMemorySelect) onMemorySelect(memory);
                        toggleMemorySelection(memory.id);
                      }}
                    >
                      <div className="memory-timeline-dot" />
                      <div className="memory-timeline-content">
                        <div className="memory-timeline-header">
                          <span className={`tribe-badge tribe-badge-${memory.type === 'experience' ? 'info' : 
                            memory.type === 'insight' ? 'success' : 
                            memory.type === 'reflection' ? 'secondary' : 'warning'}`}>
                            {memory.type}
                          </span>
                          <span className="memory-timeline-time">
                            {new Date(memory.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="memory-timeline-text">{memory.content}</p>
                        <div className="memory-timeline-tags">
                          {memory.tags.map(tag => (
                            <span key={tag} className="memory-tag">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
        
        {viewMode === 'clusters' && (
          <div className="memory-clusters-view">
            <div className="memory-clusters">
              {filteredMemories.length === 0 ? (
                <div className="empty-state">
                  <p>No memories to display in clusters</p>
                </div>
              ) : (
                <>
                  <div className="cluster-group">
                    <h3>Experiences</h3>
                    <div className="cluster-items">
                      {filteredMemories
                        .filter(memory => memory.type === 'experience')
                        .map(memory => (
                          <div 
                            key={memory.id} 
                            className={`memory-cluster-item ${selectedMemories.includes(memory.id) ? 'selected' : ''}`}
                            onClick={() => {
                              if (onMemorySelect) onMemorySelect(memory);
                              toggleMemorySelection(memory.id);
                            }}
                          >
                            <p>{memory.content}</p>
                            <div className="memory-cluster-tags">
                              {memory.tags.map(tag => (
                                <span key={tag} className="memory-tag">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                  
                  <div className="cluster-group">
                    <h3>Insights</h3>
                    <div className="cluster-items">
                      {filteredMemories
                        .filter(memory => memory.type === 'insight')
                        .map(memory => (
                          <div 
                            key={memory.id} 
                            className={`memory-cluster-item ${selectedMemories.includes(memory.id) ? 'selected' : ''}`}
                            onClick={() => {
                              if (onMemorySelect) onMemorySelect(memory);
                              toggleMemorySelection(memory.id);
                            }}
                          >
                            <p>{memory.content}</p>
                            <div className="memory-cluster-tags">
                              {memory.tags.map(tag => (
                                <span key={tag} className="memory-tag">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                  
                  <div className="cluster-group">
                    <h3>Reflections</h3>
                    <div className="cluster-items">
                      {filteredMemories
                        .filter(memory => memory.type === 'reflection')
                        .map(memory => (
                          <div 
                            key={memory.id} 
                            className={`memory-cluster-item ${selectedMemories.includes(memory.id) ? 'selected' : ''}`}
                            onClick={() => {
                              if (onMemorySelect) onMemorySelect(memory);
                              toggleMemorySelection(memory.id);
                            }}
                          >
                            <p>{memory.content}</p>
                            <div className="memory-cluster-tags">
                              {memory.tags.map(tag => (
                                <span key={tag} className="memory-tag">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                  
                  <div className="cluster-group">
                    <h3>Feedback</h3>
                    <div className="cluster-items">
                      {filteredMemories
                        .filter(memory => memory.type === 'feedback')
                        .map(memory => (
                          <div 
                            key={memory.id} 
                            className={`memory-cluster-item ${selectedMemories.includes(memory.id) ? 'selected' : ''}`}
                            onClick={() => {
                              if (onMemorySelect) onMemorySelect(memory);
                              toggleMemorySelection(memory.id);
                            }}
                          >
                            <p>{memory.content}</p>
                            <div className="memory-cluster-tags">
                              {memory.tags.map(tag => (
                                <span key={tag} className="memory-tag">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      
      {selectedMemories.length > 0 && (
        <div className="memory-context-controls">
          <div className="selected-memories-count">
            <span>{selectedMemories.length} memories selected for context</span>
          </div>
          <div className="context-actions">
            <button 
              className="tribe-button tribe-button-primary tribe-button-sm"
              onClick={() => {
                if (onContextUpdate) onContextUpdate(selectedMemories);
              }}
            >
              Apply as Context
            </button>
            <button 
              className="tribe-button tribe-button-secondary tribe-button-sm"
              onClick={() => {
                setSelectedMemories([]);
                if (onContextUpdate) onContextUpdate([]);
              }}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryVisualization;