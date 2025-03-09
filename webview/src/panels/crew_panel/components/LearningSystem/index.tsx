import React, { useState, useMemo } from 'react';
import { Brain, BookOpen, ArrowUpRight, Zap, CheckCircle, ChevronDown, ChevronUp, Download, Search, MessageCircle, FileText, ArrowRight, Network } from 'lucide-react';
import MemoryVisualization from '../MemoryVisualization';
import './styles.css';

interface Experience {
  id: string;
  agent_id: string;
  context: string;
  decision: string;
  outcome: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface Insight {
  id: string;
  agent_id: string;
  topic: string;
  learning: string;
  confidence: number;
  source_experiences: string[];
  created_at: string;
}

interface Feedback {
  id: string;
  source_id: string;
  target_id: string;
  content: string;
  feedback_type: 'improvement' | 'praise' | 'correction';
  created_at: string;
}

interface Reflection {
  id: string;
  agent_id: string;
  focus: string;
  insights: string[];
  action_plan: string[];
  created_at: string;
}

interface LearningSystemProps {
  experiences?: Experience[];
  insights?: Insight[];
  reflections?: Reflection[];
  feedback?: Feedback[];
  agentNames: Record<string, string>;
  onCaptureExperience?: (experience: Omit<Experience, 'id' | 'timestamp'>) => Promise<any>;
  onExtractPatterns?: (agentId: string, topic: string) => Promise<any>;
  onCreateReflection?: (reflection: Omit<Reflection, 'id' | 'created_at'>) => Promise<any>;
  onCollectFeedback?: (feedback: Omit<Feedback, 'id' | 'created_at'>) => Promise<any>;
  onGenerateSummary?: (agentId: string) => Promise<any>;
  onUpdateAgentContext?: (memoryIds: string[]) => Promise<any>;
}

export const LearningSystem: React.FC<LearningSystemProps> = ({
  experiences = [],
  insights = [],
  reflections = [],
  feedback = [],
  agentNames,
  onCaptureExperience,
  onExtractPatterns,
  onCreateReflection,
  onCollectFeedback,
  onGenerateSummary,
  onUpdateAgentContext
}) => {
  const [activeTab, setActiveTab] = useState<'experiences' | 'insights' | 'reflections' | 'feedback' | 'visualization'>('experiences');
  const [showCaptureForm, setShowCaptureForm] = useState(false);
  const [showExtractForm, setShowExtractForm] = useState(false);
  const [showReflectionForm, setShowReflectionForm] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [expandedExperiences, setExpandedExperiences] = useState<string[]>([]);
  const [expandedInsights, setExpandedInsights] = useState<string[]>([]);
  const [expandedReflections, setExpandedReflections] = useState<string[]>([]);
  const [expandedFeedback, setExpandedFeedback] = useState<string[]>([]);
  
  // Form states for capturing experience
  const [agentId, setAgentId] = useState('');
  const [contextValue, setContextValue] = useState('');
  const [decision, setDecision] = useState('');
  const [outcomeValue, setOutcomeValue] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Form states for extracting patterns
  const [extractAgentId, setExtractAgentId] = useState('');
  const [topic, setTopic] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  
  // Form states for creating reflection
  const [reflectionAgentId, setReflectionAgentId] = useState('');
  const [reflectionFocus, setReflectionFocus] = useState('');
  const [reflectionInsights, setReflectionInsights] = useState<string[]>(['']);
  const [reflectionActionPlan, setReflectionActionPlan] = useState<string[]>(['']);
  const [isCreatingReflection, setIsCreatingReflection] = useState(false);
  
  // Form states for collecting feedback
  const [feedbackSourceId, setFeedbackSourceId] = useState('');
  const [feedbackTargetId, setFeedbackTargetId] = useState('');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackType, setFeedbackType] = useState<'improvement' | 'praise' | 'correction'>('improvement');
  const [isCollectingFeedback, setIsCollectingFeedback] = useState(false);
  
  const toggleExperienceExpand = (id: string) => {
    setExpandedExperiences(prev => 
      prev.includes(id) ? prev.filter(eId => eId !== id) : [...prev, id]
    );
  };
  
  const toggleInsightExpand = (id: string) => {
    setExpandedInsights(prev => 
      prev.includes(id) ? prev.filter(iId => iId !== id) : [...prev, id]
    );
  };
  
  const toggleReflectionExpand = (id: string) => {
    setExpandedReflections(prev => 
      prev.includes(id) ? prev.filter(rId => rId !== id) : [...prev, id]
    );
  };
  
  const toggleFeedbackExpand = (id: string) => {
    setExpandedFeedback(prev => 
      prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]
    );
  };
  
  const handleCaptureExperience = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCapturing(true);
    
    try {
      const context = JSON.parse(contextValue);
      const outcome = JSON.parse(outcomeValue);
      
      if (onCaptureExperience) {
        await onCaptureExperience({
          agent_id: agentId,
          context,
          decision,
          outcome
        });
        
        // Reset form on success
        setAgentId('');
        setContextValue('');
        setDecision('');
        setOutcomeValue('');
        setShowCaptureForm(false);
      }
    } catch (error) {
      console.error('Error capturing experience:', error);
      alert('Error: Please ensure all JSON fields are properly formatted.');
    } finally {
      setIsCapturing(false);
    }
  };
  
  const handleExtractPatterns = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExtracting(true);
    
    try {
      if (onExtractPatterns) {
        await onExtractPatterns(extractAgentId, topic);
        // Reset form on success
        setShowExtractForm(false);
      }
    } catch (error) {
      console.error('Error extracting patterns:', error);
    } finally {
      setIsExtracting(false);
    }
  };
  
  const handleCreateReflection = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingReflection(true);
    
    try {
      if (onCreateReflection) {
        // Filter out empty insights and action plan steps
        const insights = reflectionInsights.filter(insight => insight.trim().length > 0);
        const actionPlan = reflectionActionPlan.filter(step => step.trim().length > 0);
        
        if (insights.length === 0) {
          alert('Please add at least one insight');
          setIsCreatingReflection(false);
          return;
        }
        
        if (actionPlan.length === 0) {
          alert('Please add at least one action plan step');
          setIsCreatingReflection(false);
          return;
        }
        
        await onCreateReflection({
          agent_id: reflectionAgentId,
          focus: reflectionFocus,
          insights,
          action_plan: actionPlan
        });
        
        // Reset form on success
        setReflectionAgentId('');
        setReflectionFocus('');
        setReflectionInsights(['']);
        setReflectionActionPlan(['']);
        setShowReflectionForm(false);
      }
    } catch (error) {
      console.error('Error creating reflection:', error);
    } finally {
      setIsCreatingReflection(false);
    }
  };
  
  const handleCollectFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCollectingFeedback(true);
    
    try {
      if (onCollectFeedback) {
        await onCollectFeedback({
          source_id: feedbackSourceId,
          target_id: feedbackTargetId,
          content: feedbackContent,
          feedback_type: feedbackType
        });
        
        // Reset form on success
        setFeedbackSourceId('');
        setFeedbackTargetId('');
        setFeedbackContent('');
        setFeedbackType('improvement');
        setShowFeedbackForm(false);
      }
    } catch (error) {
      console.error('Error collecting feedback:', error);
    } finally {
      setIsCollectingFeedback(false);
    }
  };
  
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };
  
  const getAgentName = (id: string) => {
    return agentNames[id] || id;
  };
  
  const downloadJson = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  // Transform memories for visualization
  const memoriesForVisualization = useMemo(() => {
    // Create an array of memory objects for visualization
    const expMemories = experiences.map(exp => ({
      id: exp.id,
      content: exp.decision,
      source: getAgentName(exp.agent_id),
      timestamp: exp.timestamp,
      type: 'experience' as const,
      tags: ['experience', exp.agent_id],
      relevance: 1,
      connections: []
    }));
    
    const insightMemories = insights.map(insight => ({
      id: insight.id,
      content: insight.learning,
      source: getAgentName(insight.agent_id),
      timestamp: insight.created_at,
      type: 'insight' as const,
      tags: ['insight', insight.topic, insight.agent_id],
      relevance: insight.confidence,
      connections: insight.source_experiences
    }));
    
    const reflectionMemories = reflections.map(reflection => ({
      id: reflection.id,
      content: reflection.focus,
      source: getAgentName(reflection.agent_id),
      timestamp: reflection.created_at,
      type: 'reflection' as const,
      tags: ['reflection', reflection.agent_id],
      relevance: 1,
      connections: reflection.insights
    }));
    
    const feedbackMemories = feedback.map(f => ({
      id: f.id,
      content: f.content,
      source: getAgentName(f.source_id),
      timestamp: f.created_at,
      type: 'feedback' as const,
      tags: ['feedback', f.feedback_type, f.source_id, f.target_id],
      relevance: 1,
      connections: [f.target_id]
    }));
    
    return [...expMemories, ...insightMemories, ...reflectionMemories, ...feedbackMemories];
  }, [experiences, insights, reflections, feedback, agentNames]);
  
  // Handle context updates
  const handleContextUpdate = async (memoryIds: string[]) => {
    if (onUpdateAgentContext) {
      try {
        await onUpdateAgentContext(memoryIds);
      } catch (error) {
        console.error('Error updating agent context:', error);
      }
    }
  };

  return (
    <div className="learning-system tribe-card">
      <div className="learning-system-header">
        <div className="learning-system-icon">
          <Brain size={24} />
        </div>
        <h2>Learning System</h2>
      </div>
      
      <div className="learning-system-tabs">
        <button 
          className={`learning-system-tab ${activeTab === 'experiences' ? 'active' : ''}`}
          onClick={() => setActiveTab('experiences')}
        >
          <BookOpen size={16} />
          <span>Experiences</span>
        </button>
        <button 
          className={`learning-system-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          <Zap size={16} />
          <span>Insights</span>
        </button>
        <button 
          className={`learning-system-tab ${activeTab === 'reflections' ? 'active' : ''}`}
          onClick={() => setActiveTab('reflections')}
        >
          <Search size={16} />
          <span>Reflections</span>
        </button>
        <button 
          className={`learning-system-tab ${activeTab === 'feedback' ? 'active' : ''}`}
          onClick={() => setActiveTab('feedback')}
        >
          <MessageCircle size={16} />
          <span>Feedback</span>
        </button>
        <button 
          className={`learning-system-tab ${activeTab === 'visualization' ? 'active' : ''}`}
          onClick={() => setActiveTab('visualization')}
        >
          <Network size={16} />
          <span>Memory Map</span>
        </button>
      </div>
      
      <div className="learning-system-content">
        {activeTab === 'experiences' ? (
          <div className="experiences-tab">
            <div className="tab-actions">
              <button 
                className="action-button"
                onClick={() => setShowCaptureForm(!showCaptureForm)}
              >
                <ArrowUpRight size={16} />
                {showCaptureForm ? 'Cancel' : 'Capture Experience'}
              </button>
            </div>
            
            {showCaptureForm && (
              <div className="capture-form-container">
                <h3>Capture New Experience</h3>
                <form onSubmit={handleCaptureExperience}>
                  <div className="form-group">
                    <label htmlFor="agentId">Agent</label>
                    <select
                      id="agentId"
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      required
                    >
                      <option value="">Select an agent</option>
                      {Object.entries(agentNames).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="context">Context</label>
                    <textarea
                      id="context"
                      value={contextValue}
                      onChange={(e) => setContextValue(e.target.value)}
                      placeholder="Describe the situation or problem that required a decision"
                      rows={3}
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="decision">Decision</label>
                    <input
                      type="text"
                      id="decision"
                      value={decision}
                      onChange={(e) => setDecision(e.target.value)}
                      placeholder="What action or decision was taken"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="outcome">Outcome</label>
                    <textarea
                      id="outcome"
                      value={outcomeValue}
                      onChange={(e) => setOutcomeValue(e.target.value)}
                      placeholder="What was the result of the decision"
                      rows={3}
                      required
                    />
                  </div>
                  
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="cancel-button"
                      onClick={() => setShowCaptureForm(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="submit-button"
                      disabled={isCapturing}
                    >
                      {isCapturing ? (
                        <>
                          <div className="spinner"></div>
                          Capturing...
                        </>
                      ) : (
                        <>
                          <ArrowUpRight size={14} />
                          Capture Experience
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            <div className="experiences-list">
              <h3>Captured Experiences ({experiences.length})</h3>
              
              {experiences.length === 0 ? (
                <div className="empty-state">
                  <p>No experiences captured yet.</p>
                  <button 
                    className="action-button"
                    onClick={() => setShowCaptureForm(true)}
                  >
                    <ArrowUpRight size={16} />
                    Capture First Experience
                  </button>
                </div>
              ) : (
                <>
                  {experiences.map((experience) => (
                    <div 
                      key={experience.id} 
                      className={`experience-item ${expandedExperiences.includes(experience.id) ? 'expanded' : ''}`}
                    >
                      <div 
                        className="experience-header"
                        onClick={() => toggleExperienceExpand(experience.id)}
                      >
                        <div className="experience-title">
                          <span className="experience-decision">{experience.decision}</span>
                          <span className="experience-agent">{getAgentName(experience.agent_id)}</span>
                        </div>
                        <div className="experience-meta">
                          <span className="experience-time">{formatTimestamp(experience.timestamp)}</span>
                          <button className="expand-button">
                            {expandedExperiences.includes(experience.id) ? (
                              <ChevronUp size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      
                      {expandedExperiences.includes(experience.id) && (
                        <div className="experience-details">
                          <div className="detail-section">
                            <h4>Context</h4>
                            <p>{experience.context}</p>
                          </div>
                          
                          <div className="detail-section">
                            <h4>Outcome</h4>
                            <p>{experience.outcome}</p>
                          </div>
                          
                          {experience.metadata && Object.keys(experience.metadata).length > 0 && (
                            <div className="detail-section">
                              <h4>Metadata</h4>
                              <pre>{JSON.stringify(experience.metadata, null, 2)}</pre>
                            </div>
                          )}
                          
                          <div className="experience-actions">
                            <button 
                              className="action-button-small"
                              onClick={() => downloadJson(experience, `experience-${experience.id}.json`)}
                            >
                              <Download size={14} />
                              Export
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'insights' ? (
          <div className="insights-tab">
            <div className="tab-actions">
              <button 
                className="action-button"
                onClick={() => setShowExtractForm(!showExtractForm)}
              >
                <Zap size={16} />
                {showExtractForm ? 'Cancel' : 'Extract Insights'}
              </button>
            </div>
            
            {showExtractForm && (
              <div className="extract-form-container">
                <h3>Extract Insights</h3>
                <form onSubmit={handleExtractPatterns}>
                  <div className="form-group">
                    <label htmlFor="extractAgentId">Agent</label>
                    <select
                      id="extractAgentId"
                      value={extractAgentId}
                      onChange={(e) => setExtractAgentId(e.target.value)}
                      required
                    >
                      <option value="">Select an agent</option>
                      {Object.entries(agentNames).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="topic">Topic</label>
                    <input
                      type="text"
                      id="topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g., Error Handling"
                      required
                    />
                  </div>
                  
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="cancel-button"
                      onClick={() => setShowExtractForm(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="submit-button"
                      disabled={isExtracting}
                    >
                      {isExtracting ? (
                        <>
                          <div className="spinner"></div>
                          Extracting...
                        </>
                      ) : (
                        <>
                          <Zap size={14} />
                          Extract Insights
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            <div className="insights-list">
              <h3>Extracted Insights ({insights.length})</h3>
              
              {insights.length === 0 ? (
                <div className="empty-state">
                  <p>No insights extracted yet.</p>
                  <button 
                    className="action-button"
                    onClick={() => setShowExtractForm(true)}
                  >
                    <Zap size={16} />
                    Extract First Insight
                  </button>
                </div>
              ) : (
                <>
                  {insights.map((insight) => (
                    <div 
                      key={insight.id} 
                      className={`insight-item ${expandedInsights.includes(insight.id) ? 'expanded' : ''}`}
                    >
                      <div 
                        className="insight-header"
                        onClick={() => toggleInsightExpand(insight.id)}
                      >
                        <div className="insight-title">
                          <span className="insight-topic">{insight.topic}</span>
                          <span className="insight-agent">{getAgentName(insight.agent_id)}</span>
                        </div>
                        <div className="insight-meta">
                          <span className="insight-confidence">
                            <CheckCircle size={14} /> {(insight.confidence * 100).toFixed(0)}%
                          </span>
                          <button className="expand-button">
                            {expandedInsights.includes(insight.id) ? (
                              <ChevronUp size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      
                      {expandedInsights.includes(insight.id) && (
                        <div className="insight-details">
                          <div className="detail-section">
                            <h4>Learning</h4>
                            <p>{insight.learning}</p>
                          </div>
                          
                          <div className="detail-section">
                            <h4>Source Experiences</h4>
                            <p>{insight.source_experiences.length} experiences contributed to this insight</p>
                            <ul className="source-experiences-list">
                              {insight.source_experiences.map((expId, i) => {
                                const exp = experiences.find(e => e.timestamp === expId);
                                return (
                                  <li key={i}>
                                    {exp ? exp.decision : expId}
                                    {exp && <span className="experience-time">{formatTimestamp(exp.timestamp)}</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                          
                          <div className="insight-actions">
                            <button 
                              className="action-button-small"
                              onClick={() => downloadJson(insight, `insight-${insight.id}.json`)}
                            >
                              <Download size={14} />
                              Export
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'reflections' ? (
          <div className="reflections-tab">
            <div className="tab-actions">
              <button 
                className="action-button"
                onClick={() => setShowReflectionForm(!showReflectionForm)}
              >
                <FileText size={16} />
                {showReflectionForm ? 'Cancel' : 'Create Reflection'}
              </button>
            </div>
            
            {showReflectionForm && (
              <div className="reflection-form-container">
                <h3>Create Reflection</h3>
                <form onSubmit={handleCreateReflection}>
                  <div className="form-group">
                    <label htmlFor="reflectionAgentId">Agent</label>
                    <select
                      id="reflectionAgentId"
                      value={reflectionAgentId}
                      onChange={(e) => setReflectionAgentId(e.target.value)}
                      required
                    >
                      <option value="">Select an agent</option>
                      {Object.entries(agentNames).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="reflectionFocus">Focus</label>
                    <input
                      type="text"
                      id="reflectionFocus"
                      value={reflectionFocus}
                      onChange={(e) => setReflectionFocus(e.target.value)}
                      placeholder="e.g., Code Quality"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Insights</label>
                    {reflectionInsights.map((insight, index) => (
                      <div className="array-input-row" key={`insight-${index}`}>
                        <input
                          type="text"
                          value={insight}
                          onChange={(e) => {
                            const newInsights = [...reflectionInsights];
                            newInsights[index] = e.target.value;
                            setReflectionInsights(newInsights);
                          }}
                          placeholder="Enter an insight"
                        />
                        <button
                          type="button"
                          className="array-input-button remove"
                          onClick={() => {
                            if (reflectionInsights.length > 1) {
                              const newInsights = reflectionInsights.filter((_, i) => i !== index);
                              setReflectionInsights(newInsights);
                            }
                          }}
                        >
                          -
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="array-input-button add"
                      onClick={() => setReflectionInsights([...reflectionInsights, ''])}
                    >
                      + Add Insight
                    </button>
                  </div>
                  
                  <div className="form-group">
                    <label>Action Plan</label>
                    {reflectionActionPlan.map((step, index) => (
                      <div className="array-input-row" key={`step-${index}`}>
                        <input
                          type="text"
                          value={step}
                          onChange={(e) => {
                            const newSteps = [...reflectionActionPlan];
                            newSteps[index] = e.target.value;
                            setReflectionActionPlan(newSteps);
                          }}
                          placeholder="Enter an action step"
                        />
                        <button
                          type="button"
                          className="array-input-button remove"
                          onClick={() => {
                            if (reflectionActionPlan.length > 1) {
                              const newSteps = reflectionActionPlan.filter((_, i) => i !== index);
                              setReflectionActionPlan(newSteps);
                            }
                          }}
                        >
                          -
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="array-input-button add"
                      onClick={() => setReflectionActionPlan([...reflectionActionPlan, ''])}
                    >
                      + Add Action Step
                    </button>
                  </div>
                  
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="cancel-button"
                      onClick={() => setShowReflectionForm(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="submit-button"
                      disabled={isCreatingReflection}
                    >
                      {isCreatingReflection ? (
                        <>
                          <div className="spinner"></div>
                          Creating...
                        </>
                      ) : (
                        <>
                          <FileText size={14} />
                          Create Reflection
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            <div className="reflections-list">
              <h3>Reflections ({reflections.length})</h3>
              
              {reflections.length === 0 ? (
                <div className="empty-state">
                  <p>No reflections created yet.</p>
                  <button 
                    className="action-button"
                    onClick={() => setShowReflectionForm(true)}
                  >
                    <FileText size={16} />
                    Create First Reflection
                  </button>
                </div>
              ) : (
                <>
                  {reflections.map((reflection) => (
                    <div 
                      key={reflection.id} 
                      className={`reflection-item ${expandedReflections.includes(reflection.id) ? 'expanded' : ''}`}
                    >
                      <div 
                        className="reflection-header"
                        onClick={() => toggleReflectionExpand(reflection.id)}
                      >
                        <div className="reflection-title">
                          <span className="reflection-focus">{reflection.focus}</span>
                          <span className="reflection-agent">{getAgentName(reflection.agent_id)}</span>
                        </div>
                        <div className="reflection-meta">
                          <span className="reflection-time">{formatTimestamp(reflection.created_at)}</span>
                          <button className="expand-button">
                            {expandedReflections.includes(reflection.id) ? (
                              <ChevronUp size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      
                      {expandedReflections.includes(reflection.id) && (
                        <div className="reflection-details">
                          <div className="detail-section">
                            <h4>Insights</h4>
                            <ul>
                              {reflection.insights.map((insight, i) => (
                                <li key={i}>{insight}</li>
                              ))}
                            </ul>
                          </div>
                          
                          <div className="detail-section">
                            <h4>Action Plan</h4>
                            <ol>
                              {reflection.action_plan.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                          
                          <div className="reflection-actions">
                            <button 
                              className="action-button-small"
                              onClick={() => downloadJson(reflection, `reflection-${reflection.id}.json`)}
                            >
                              <Download size={14} />
                              Export
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'feedback' ? (
          <div className="feedback-tab">
            <div className="tab-actions">
              <button 
                className="action-button"
                onClick={() => setShowFeedbackForm(!showFeedbackForm)}
              >
                <MessageCircle size={16} />
                {showFeedbackForm ? 'Cancel' : 'Give Feedback'}
              </button>
            </div>
            
            {showFeedbackForm && (
              <div className="feedback-form-container">
                <h3>Give Feedback</h3>
                <form onSubmit={handleCollectFeedback}>
                  <div className="form-group">
                    <label htmlFor="feedbackSourceId">From Agent</label>
                    <select
                      id="feedbackSourceId"
                      value={feedbackSourceId}
                      onChange={(e) => setFeedbackSourceId(e.target.value)}
                      required
                    >
                      <option value="">Select source agent</option>
                      {Object.entries(agentNames).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="feedbackTargetId">To Agent</label>
                    <select
                      id="feedbackTargetId"
                      value={feedbackTargetId}
                      onChange={(e) => setFeedbackTargetId(e.target.value)}
                      required
                    >
                      <option value="">Select target agent</option>
                      {Object.entries(agentNames).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="feedbackType">Type</label>
                    <select
                      id="feedbackType"
                      value={feedbackType}
                      onChange={(e) => setFeedbackType(e.target.value as any)}
                      required
                    >
                      <option value="improvement">Improvement</option>
                      <option value="praise">Praise</option>
                      <option value="correction">Correction</option>
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="feedbackContent">Content</label>
                    <textarea
                      id="feedbackContent"
                      value={feedbackContent}
                      onChange={(e) => setFeedbackContent(e.target.value)}
                      placeholder="Enter your feedback message"
                      rows={3}
                      required
                    />
                  </div>
                  
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="cancel-button"
                      onClick={() => setShowFeedbackForm(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="submit-button"
                      disabled={isCollectingFeedback}
                    >
                      {isCollectingFeedback ? (
                        <>
                          <div className="spinner"></div>
                          Submitting...
                        </>
                      ) : (
                        <>
                          <MessageCircle size={14} />
                          Submit Feedback
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            <div className="feedback-list">
              <h3>Feedback ({feedback.length})</h3>
              
              {feedback.length === 0 ? (
                <div className="empty-state">
                  <p>No feedback collected yet.</p>
                  <button 
                    className="action-button"
                    onClick={() => setShowFeedbackForm(true)}
                  >
                    <MessageCircle size={16} />
                    Give First Feedback
                  </button>
                </div>
              ) : (
                <>
                  {feedback.map((f) => (
                    <div 
                      key={f.id} 
                      className={`feedback-item ${expandedFeedback.includes(f.id) ? 'expanded' : ''} feedback-type-${f.feedback_type}`}
                    >
                      <div 
                        className="feedback-header"
                        onClick={() => toggleFeedbackExpand(f.id)}
                      >
                        <div className="feedback-title">
                          <span className={`feedback-type feedback-type-${f.feedback_type}`}>
                            {f.feedback_type.charAt(0).toUpperCase() + f.feedback_type.slice(1)}
                          </span>
                          <span className="feedback-flow">
                            {getAgentName(f.source_id)} <ArrowRight size={12} /> {getAgentName(f.target_id)}
                          </span>
                        </div>
                        <div className="feedback-meta">
                          <span className="feedback-time">{formatTimestamp(f.created_at)}</span>
                          <button className="expand-button">
                            {expandedFeedback.includes(f.id) ? (
                              <ChevronUp size={16} />
                            ) : (
                              <ChevronDown size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      
                      {expandedFeedback.includes(f.id) && (
                        <div className="feedback-details">
                          <div className="detail-section">
                            <h4>Content</h4>
                            <p>{f.content}</p>
                          </div>
                          
                          <div className="feedback-actions">
                            <button 
                              className="action-button-small"
                              onClick={() => downloadJson(f, `feedback-${f.id}.json`)}
                            >
                              <Download size={14} />
                              Export
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : (
          // Memory Visualization tab
          <div className="visualization-tab">
            <div className="tab-actions">
              <button 
                className="action-button"
                onClick={() => {
                  if (onGenerateSummary) {
                    onGenerateSummary('all'); // Generate summary for all agents
                  }
                }}
              >
                <Zap size={16} />
                Refresh Connections
              </button>
              <div className="visualization-info">
                <p>Select memories to include in agent context. Different views help you find patterns and connections.</p>
              </div>
            </div>
            
            <div className="memory-visualization-wrapper">
              <MemoryVisualization 
                memories={memoriesForVisualization}
                onMemorySelect={(memory) => {
                  console.log('Selected memory:', memory);
                  
                  // Expand the corresponding item in its tab
                  if (memory.type === 'experience') {
                    toggleExperienceExpand(memory.id);
                    setActiveTab('experiences');
                  } else if (memory.type === 'insight') {
                    toggleInsightExpand(memory.id);
                    setActiveTab('insights');
                  } else if (memory.type === 'reflection') {
                    toggleReflectionExpand(memory.id);
                    setActiveTab('reflections');
                  } else if (memory.type === 'feedback') {
                    toggleFeedbackExpand(memory.id);
                    setActiveTab('feedback');
                  }
                }}
                onContextUpdate={handleContextUpdate}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};