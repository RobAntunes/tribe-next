import React, { useState, useRef, useEffect } from 'react';
import './styles.css';
import './enhanced-styles.css';
import { Message, Agent, AgentContext } from '../../types';
import MarkdownIt from 'markdown-it';

// Initialize markdown-it instance with security options
const md = new MarkdownIt({
    html: false,        // Disable HTML tags in source
    xhtmlOut: false,    // Use '/' to close single tags (<br />)
    breaks: true,       // Convert '\n' in paragraphs into <br>
    linkify: true,      // Autoconvert URL-like text to links
    typographer: true,  // Enable smartquotes and other typographic replacements
    highlight: (str, lang) => {
        // Add language class for proper syntax highlighting
        return `<pre class="language-${lang}"><code class="language-${lang}">${str}</code></pre>`;
    }
});

// Interface for message reactions
interface MessageReaction {
    emoji: string;
    count: number;
    users: string[];
}

// Interface for attachments
interface Attachment {
    id: string;
    type: 'file' | 'code' | 'image' | 'link';
    name: string;
    content?: string;
    url?: string;
    language?: string;
    metadata?: Record<string, any>;
}

// Interface for agent operations (activities the agent is performing)
interface AgentOperation {
    id: string;
    type: 'thinking' | 'coding' | 'searching' | 'reading' | 'writing' | 'analyzing' | 'executing' | 'learning' | 'planning' | 'debugging';
    description: string;
    startTime: Date;
    endTime?: Date;
    progress?: number; // 0-100
    status: 'in_progress' | 'completed' | 'failed';
    metadata?: Record<string, any>;
}

// Enhanced Message interface to include thread, parent, and attachment info
interface EnhancedMessage extends Message {
    threadId?: string;
    parentId?: string;
    attachments?: Attachment[];
    reactions?: MessageReaction[];
    isTyping?: boolean;
    directTo?: string; // ID of the agent this message is directed to (for agent-to-agent messaging)
    recipientIds?: string[]; // IDs of multiple recipients for group messaging
    currentOperation?: AgentOperation; // Current operation the agent is performing
}

// Define emojis for reactions
const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🤔', '👀', '🙌'];

// Safe markdown renderer component
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    // Preprocess content to handle escaped newlines
    const preprocessedContent = content
        ? content
            .replace(/\\n/g, '\n') // Replace escaped newlines with actual newlines
            .replace(/\\t/g, '    ') // Replace escaped tabs with spaces
        : '';
    
    // Use the markdown-it library to render the content
    const renderedHtml = md.render(preprocessedContent);
    
    // Function to extract only relevant code snippets
    const formatCodeForDisplay = (code: string, lang: string): string => {
        // If code is too large, show only beginning and end with indication of truncation
        const maxLines = 30;
        const lines = code.split('\n');
        
        if (lines.length > maxLines) {
            // If it's a command, keep it all (likely bash commands)
            if (lang === 'bash' || lang === 'sh' || lang === 'cmd') {
                return code;
            }
            
            // For code, keep first 10 lines and last 10 lines with an ellipsis in the middle
            const startLines = lines.slice(0, 15).join('\n');
            const endLines = lines.slice(-15).join('\n');
            return `${startLines}\n\n// ... ${lines.length - 30} more lines ...\n\n${endLines}`;
        }
        
        return code;
    };
    
    // Wrap code blocks with action buttons and diff preview option
    const enhancedHtml = renderedHtml.replace(
        /<pre class="language-([^"]*)"><code class="language-([^"]*)">([^<]+)<\/code><\/pre>/g, 
        (match, lang1, lang2, code) => {
            // Process code for display to show only relevant parts
            const displayCode = formatCodeForDisplay(code, lang1);
            
            return `<pre class="language-${lang1}">
                <div class="code-actions">
                    <button class="code-action-button copy" title="Copy full code" data-code="${encodeURIComponent(code)}" data-lang="${lang1}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="code-action-button apply" title="Apply to Editor" data-code="${encodeURIComponent(code)}" data-lang="${lang1}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="code-action-button preview-diff" title="Preview Diff" data-code="${encodeURIComponent(code)}" data-lang="${lang1}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </button>
                </div>
                <code class="language-${lang2}">${displayCode}</code>
            </pre>`;
        }
    );
    
    // Use a ref to handle the button click events after rendering
    const contentRef = React.useRef<HTMLDivElement>(null);
    
    React.useEffect(() => {
        if (!contentRef.current) return;
        
        // Add click handlers for the code action buttons
        const copyButtons = contentRef.current.querySelectorAll('.code-action-button.copy');
        const applyButtons = contentRef.current.querySelectorAll('.code-action-button.apply');
        const diffButtons = contentRef.current.querySelectorAll('.code-action-button.preview-diff');
        
        copyButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.currentTarget as HTMLButtonElement;
                const code = decodeURIComponent(btn.getAttribute('data-code') || '');
                navigator.clipboard.writeText(code).then(() => {
                    // Show temporary "Copied!" feedback
                    btn.textContent = '✓';
                    setTimeout(() => {
                        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>`;
                    }, 1500);
                });
            });
        });
        
        applyButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.currentTarget as HTMLButtonElement;
                const code = decodeURIComponent(btn.getAttribute('data-code') || '');
                const lang = btn.getAttribute('data-lang') || '';
                
                // Send message to VSCode to apply the code
                const vscode = (window.parent as any)['_vscode'];
                // If we can't find VSCode API, fall back to the more generic method
                const vsCodeApi = vscode || (window as any).acquireVsCodeApi?.();
                vsCodeApi.postMessage({
                    type: 'APPLY_CODE',
                    payload: {
                        code,
                        language: lang
                    }
                });
                
                // Show temporary "Applied!" feedback
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>`;
                }, 1500);
            });
        });

        diffButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.currentTarget as HTMLButtonElement;
                const code = decodeURIComponent(btn.getAttribute('data-code') || '');
                const lang = btn.getAttribute('data-lang') || '';
                
                // Send message to VSCode for enhanced diff preview with multi-file support
                const vscode = (window.parent as any)['_vscode'];
                const vsCodeApi = vscode || (window as any).acquireVsCodeApi?.();
                vsCodeApi.postMessage({
                    type: 'PREVIEW_DIFF',
                    payload: {
                        code,
                        language: lang,
                        options: {
                            fullChanges: true,     // Show changes across all affected files
                            showSideBySide: true,  // Enable side by side comparison
                            highlightChanges: true, // Highlight specific changes within files
                            showInPanel: true      // Show in dedicated panel instead of popup
                        }
                    }
                });
                
                // Show temporary feedback
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>`;
                }, 1500);
            });
        });
        
        // Cleanup event listeners
        return () => {
            copyButtons.forEach(button => {
                button.removeEventListener('click', () => {});
            });
            applyButtons.forEach(button => {
                button.removeEventListener('click', () => {});
            });
            diffButtons.forEach(button => {
                button.removeEventListener('click', () => {});
            });
        };
    }, [renderedHtml]);
    
    return (
        <div 
            ref={contentRef}
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: enhancedHtml }}
        />
    );
};

// Attachment renderer component
const AttachmentRenderer: React.FC<{ attachment: Attachment }> = ({ attachment }) => {
    switch (attachment.type) {
        case 'code':
            return (
                <div className="message-attachment code-attachment">
                    <div className="attachment-header">
                        <span className="attachment-name">{attachment.name}</span>
                        <span className="attachment-language">{attachment.language}</span>
                    </div>
                    <MarkdownRenderer content={`\`\`\`${attachment.language}\n${attachment.content}\n\`\`\``} />
                </div>
            );
        case 'image':
            return (
                <div className="message-attachment image-attachment">
                    <div className="attachment-header">
                        <span className="attachment-name">{attachment.name}</span>
                    </div>
                    <img src={attachment.url} alt={attachment.name} />
                </div>
            );
        case 'link':
            return (
                <div className="message-attachment link-attachment">
                    <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                        <div className="attachment-link-container">
                            <span className="attachment-link-icon">🔗</span>
                            <span className="attachment-link-text">{attachment.name}</span>
                        </div>
                    </a>
                </div>
            );
        case 'file':
            return (
                <div className="message-attachment file-attachment">
                    <div className="attachment-file-container">
                        <span className="attachment-file-icon">📄</span>
                        <span className="attachment-file-name">{attachment.name}</span>
                        {attachment.url && (
                            <a 
                                href={attachment.url} 
                                className="attachment-file-download" 
                                download
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Handle file download through VSCode API
                                    const vscode = (window.parent as any)['_vscode'];
                                    const vsCodeApi = vscode || (window as any).acquireVsCodeApi?.();
                                    vsCodeApi.postMessage({
                                        type: 'DOWNLOAD_FILE',
                                        payload: {
                                            url: attachment.url,
                                            name: attachment.name
                                        }
                                    });
                                }}
                            >
                                Download
                            </a>
                        )}
                    </div>
                </div>
            );
        default:
            return null;
    }
};

// Reaction controls component
const ReactionControls: React.FC<{
    reactions: MessageReaction[],
    messageId: string,
    currentUserId: string | null,
    onReact: (messageId: string, emoji: string) => void
}> = ({ reactions, messageId, currentUserId, onReact }) => {
    const [showReactionPicker, setShowReactionPicker] = useState(false);
    
    return (
        <div className="message-reactions-container">
            {/* Display existing reactions */}
            <div className="message-reactions">
                {reactions.map((reaction, index) => (
                    <button 
                        key={`${reaction.emoji}-${index}`}
                        className={`reaction-button ${reaction.users.includes(currentUserId || '') ? 'active' : ''}`}
                        onClick={() => onReact(messageId, reaction.emoji)}
                    >
                        <span className="reaction-emoji">{reaction.emoji}</span>
                        <span className="reaction-count">{reaction.count}</span>
                    </button>
                ))}
            </div>
            
            {/* Add reaction button */}
            <button 
                className="add-reaction-button"
                onClick={() => setShowReactionPicker(!showReactionPicker)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                </svg>
            </button>
            
            {/* Reaction picker */}
            {showReactionPicker && (
                <div className="reaction-picker">
                    {REACTION_EMOJIS.map(emoji => (
                        <button 
                            key={emoji}
                            className="emoji-button"
                            onClick={() => {
                                onReact(messageId, emoji);
                                setShowReactionPicker(false);
                            }}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// Thread message view component
const ThreadView: React.FC<{
    threadId: string,
    messages: EnhancedMessage[],
    currentUserId: string | null,
    agents: Agent[],
    onReact: (messageId: string, emoji: string) => void,
    onReply: (messageId: string, threadId: string) => void,
    onClose: () => void
}> = ({ 
    threadId, 
    messages, 
    currentUserId, 
    agents, 
    onReact, 
    onReply, 
    onClose 
}) => {
    // Filter messages to this thread and sort by timestamp
    const threadMessages = messages
        .filter(msg => msg.threadId === threadId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Find the thread starter message for header info
    const threadStarter = threadMessages.length > 0 ? threadMessages[0] : null;
    
    if (!threadStarter) {
        return null;
    }
    
    return (
        <div className="thread-view">
            <div className="thread-header">
                <h3 className="thread-title">Thread</h3>
                <button className="thread-close-button" onClick={onClose}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            
            <div className="thread-original-message">
                <div className="message thread-starter">
                    <div className="message-header">
                        <div className="message-sender-info">
                            <span className="sender">{threadStarter.sender}</span>
                            {threadStarter.type === 'agent' && threadStarter.agentContext && (
                                <span className="sender-role">{threadStarter.agentContext.role}</span>
                            )}
                        </div>
                        <span className="timestamp">
                            {new Date(threadStarter.timestamp).toLocaleString()}
                        </span>
                    </div>
                    <div className="message-content">
                        <div className="message-text">
                            <MarkdownRenderer content={threadStarter.content || ''} />
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="thread-replies">
                {threadMessages.slice(1).map(message => (
                    <div 
                        key={message.id} 
                        className={`message thread-reply ${message.type}`}
                    >
                        <div className="message-header">
                            <div className="message-sender-info">
                                <span className="sender">{message.sender}</span>
                                {message.type === 'agent' && message.agentContext && (
                                    <span className="sender-role">{message.agentContext.role}</span>
                                )}
                            </div>
                            <span className="timestamp">
                                {new Date(message.timestamp).toLocaleString()}
                            </span>
                        </div>
                        <div className="message-content">
                            <div className="message-text">
                                <MarkdownRenderer content={message.content || ''} />
                                
                                {/* Render attachments if any */}
                                {message.attachments && message.attachments.length > 0 && (
                                    <div className="message-attachments">
                                        {message.attachments.map((attachment, index) => (
                                            <AttachmentRenderer 
                                                key={`${message.id}-attachment-${index}`} 
                                                attachment={attachment} 
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* Reactions for reply */}
                        {message.reactions && (
                            <ReactionControls 
                                reactions={message.reactions}
                                messageId={message.id}
                                currentUserId={currentUserId}
                                onReact={onReact}
                            />
                        )}
                    </div>
                ))}
            </div>
            
            {/* Thread reply input - simplified placeholder for now */}
            <div className="thread-reply-composer">
                <textarea 
                    className="thread-reply-input"
                    placeholder="Reply to thread..."
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            // Here we would normally send the reply
                            // This is just a stub for now
                            console.log('Send reply to thread', threadId);
                        }
                    }}
                />
                <button 
                    className="thread-reply-button"
                    onClick={() => onReply('', threadId)} // Simplified for now
                >
                    Reply
                </button>
            </div>
        </div>
    );
};

// Operation Indicator component for showing current agent operations
export const OperationIndicator: React.FC<{ operation: AgentOperation | undefined }> = ({ operation }) => {
    if (!operation) return null;
    
    // Define icon for each operation type
    const getOperationIcon = (type: string) => {
        switch (type) {
            case 'thinking':
                return '💭';
            case 'coding':
                return '👨‍💻';
            case 'searching':
                return '🔍';
            case 'reading':
                return '📖';
            case 'writing':
                return '✏️';
            case 'analyzing':
                return '🔬';
            case 'executing':
                return '🚀';
            case 'learning':
                return '🧠';
            case 'planning':
                return '📝';
            case 'debugging':
                return '🐛';
            default:
                return '⚙️';
        }
    };
    
    // Format operation type to readable format
    const formatOperationType = (type: string) => {
        return type.charAt(0).toUpperCase() + type.slice(1);
    };
    
    // Format elapsed time
    const formatElapsedTime = (startTime: Date) => {
        const elapsed = new Date().getTime() - new Date(startTime).getTime();
        
        // If less than a minute, show seconds
        if (elapsed < 60000) {
            return `${Math.round(elapsed / 1000)}s`;
        }
        
        // If less than an hour, show minutes
        if (elapsed < 3600000) {
            return `${Math.floor(elapsed / 60000)}m ${Math.round((elapsed % 60000) / 1000)}s`;
        }
        
        // Otherwise show hours and minutes
        return `${Math.floor(elapsed / 3600000)}h ${Math.floor((elapsed % 3600000) / 60000)}m`;
    };
    
    return (
        <div className="operation-indicator">
            <div className="operation-icon">
                {getOperationIcon(operation.type)}
            </div>
            <div className="operation-details">
                <div className="operation-type">
                    {formatOperationType(operation.type)}
                </div>
                <div className="operation-description">
                    {operation.description}
                </div>
                {operation.progress !== undefined && (
                    <div className="operation-progress">
                        <div className="progress-bar">
                            <div 
                                className="progress-fill" 
                                style={{ width: `${operation.progress}%` }}
                            />
                        </div>
                        <div className="progress-text">
                            {operation.progress}%
                        </div>
                    </div>
                )}
                <div className="operation-time">
                    {formatElapsedTime(operation.startTime)}
                </div>
            </div>
        </div>
    );
};

interface ChatWindowProps {
    messages: EnhancedMessage[];
    onSendMessage?: (message: string, to?: string | string[], teamId?: string, threadId?: string, parentId?: string, directTo?: string) => void;
    onReactToMessage?: (messageId: string, emoji: string) => void;
    onViewThread?: (threadId: string) => void;
    onReplyToMessage?: (messageId: string, threadId?: string) => void;
    placeholder?: string;
    disabled?: boolean;
    loadingAgent?: string;
    currentAgentId?: string | null;
    agents?: Agent[];
    teams?: Array<{ id: string, name: string, members: string[] }>;
    messageListRef?: React.RefObject<HTMLDivElement>;
    groupByThread?: boolean;
    showTeamMessages?: boolean;
    selectedTeamId?: string;
    selectedThreadId?: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
    messages,
    onSendMessage,
    onReactToMessage,
    onViewThread,
    onReplyToMessage,
    placeholder = "Type a message...",
    disabled = false,
    loadingAgent = undefined,
    currentAgentId = null,
    agents = [],
    teams = [],
    messageListRef = React.createRef<HTMLDivElement>(),
    groupByThread = false,
    showTeamMessages = false,
    selectedTeamId,
    selectedThreadId
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [messageInput, setMessageInput] = useState<string>('');
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
    
    // State for thread view
    const [activeThreadId, setActiveThreadId] = useState<string | null>(selectedThreadId || null);
    
    // Enhanced recipient handling for agent-to-agent messaging
    const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
    const [recipientSearch, setRecipientSearch] = useState('');
    const [recipientDropdownOpen, setRecipientDropdownOpen] = useState(false);
    const [activeConversation, setActiveConversation] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    // Filter agents based on search
    const filteredAgents = agents
        .filter(agent => agent.id !== currentAgentId) // Don't show current agent as recipient
        .filter(agent => 
            !recipientSearch || 
            (agent.name?.toLowerCase().includes(recipientSearch.toLowerCase()) || 
            agent.role.toLowerCase().includes(recipientSearch.toLowerCase()))
        );
        
    // Handle recipient selection
    const handleSelectRecipient = (agentId: string) => {
        if (selectedRecipients.includes(agentId)) {
            // If already selected, remove it
            setSelectedRecipients(prev => prev.filter(id => id !== agentId));
        } else {
            // Add to selected recipients
            setSelectedRecipients(prev => [...prev, agentId]);
        }
    };
    
    // Remove a recipient
    const handleRemoveRecipient = (agentId: string) => {
        setSelectedRecipients(prev => prev.filter(id => id !== agentId));
    };
    
    // Clear all recipients
    const handleClearRecipients = () => {
        setSelectedRecipients([]);
        setRecipientSearch('');
    };
    
    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setRecipientDropdownOpen(false);
            }
        }
        
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [dropdownRef]);

    // Log when loadingAgent changes
    useEffect(() => {
        console.log('ChatWindow loadingAgent:', loadingAgent);
    }, [loadingAgent]);
    
    // Update active thread when selectedThreadId changes
    useEffect(() => {
        if (selectedThreadId) {
            setActiveThreadId(selectedThreadId);
        }
    }, [selectedThreadId]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    // Handle sending a message
    const handleSendMessage = () => {
        if (!messageInput.trim() || !onSendMessage) return;
        
        if (replyingTo) {
            // Find the message being replied to
            const replyTarget = messages.find(m => m.id === replyingTo);
            if (replyTarget) {
                // If replying to a message in a thread
                if (replyTarget.threadId) {
                    onSendMessage(messageInput, replyTarget.sender, undefined, replyTarget.threadId, replyingTo);
                } else {
                    // If replying to a message not in a thread
                    onSendMessage(messageInput, replyTarget.sender, undefined, undefined, replyingTo);
                }
            }
            setReplyingTo(null);
        } else if (selectedTeamId) {
            // If sending to a team
            onSendMessage(messageInput, undefined, selectedTeamId);
        } else if (selectedRecipients.length > 0) {
            // Enhanced agent-to-agent messaging
            if (selectedRecipients.length === 1) {
                // Direct message to a single agent - send to a single recipient
                const directRecipient = selectedRecipients[0];
                
                // Update: Add directTo property to the message by calling special "send with metadata" function
                const vscode = (window as any).acquireVsCodeApi?.();
                if (typeof (window as any).postDirectMessage === 'function') {
                    // If special handler is available, use it
                    (window as any).postDirectMessage({
                        content: messageInput,
                        directTo: directRecipient
                    });
                } else {
                    // Otherwise, use standard handler that supports recipient parameter
                    // Make sure to explicitly pass the directTo property for agent metadata
                    onSendMessage(messageInput, directRecipient, undefined, undefined, undefined, directRecipient);
                }
            } else {
                // Group message to multiple agents - use the string[] recipient type
                onSendMessage(messageInput, selectedRecipients);
            }
        } else if (selectedAgent) {
            // Legacy single agent selection (for backward compatibility)
            onSendMessage(messageInput, selectedAgent);
        } else {
            // Default behavior - broadcast to all
            onSendMessage(messageInput);
        }
        
        setMessageInput('');
    };

    // Handle viewing a thread
    const handleViewThread = (threadId: string) => {
        setActiveThreadId(threadId);
        if (onViewThread) {
            onViewThread(threadId);
        }
    };

    // Handle replying to a message
    const handleReplyToMessage = (messageId: string, threadId?: string) => {
        setReplyingTo(messageId);
        if (threadId) {
            setActiveThreadId(threadId);
        }
        if (onReplyToMessage) {
            onReplyToMessage(messageId, threadId);
        }
    };

    // Handle reacting to a message
    const handleReactToMessage = (messageId: string, emoji: string) => {
        if (onReactToMessage) {
            onReactToMessage(messageId, emoji);
        }
    };

    // Organize messages by thread if needed
    let organizedMessages = [...messages];
    
    // Filter messages based on the current agent/recipient
    if (currentAgentId) {
        // When viewing a specific agent, only show:
        // 1. Messages sent directly to this agent (directTo === currentAgentId)
        // 2. Messages sent by this agent (sender === currentAgentId)
        // 3. Messages sent to a group that includes this agent (recipientIds includes currentAgentId)
        // 4. Messages that have no specific recipient (broadcast messages)
        organizedMessages = organizedMessages.filter(msg => {
            // Check if this is a direct message to the current agent
            if ((msg as EnhancedMessage).directTo === currentAgentId) {
                return true;
            }
            
            // Check if this message was sent by the current agent
            if (msg.sender === currentAgentId) {
                return true;
            }
            
            // Check if this is a group message that includes the current agent
            const enhancedMsg = msg as EnhancedMessage;
            if (enhancedMsg.recipientIds && enhancedMsg.recipientIds.includes(currentAgentId)) {
                return true;
            }
            
            // Check if message has no specific recipient (broadcast)
            if (!enhancedMsg.directTo && !enhancedMsg.recipientIds) {
                return true;
            }
            
            return false;
        });
    }
    
    // Filter messages based on selected team or thread
    if (selectedTeamId && showTeamMessages) {
        organizedMessages = organizedMessages.filter(msg => msg.teamId === selectedTeamId);
    }
    
    // If grouping by thread is enabled, organize messages
    if (groupByThread) {
        // Group messages by thread
        const threadMap = new Map<string, EnhancedMessage[]>();
        
        // First, find all thread starter messages (those without a parentId)
        const threadStarters = organizedMessages.filter(
            msg => msg.threadId && !msg.parentId
        );
        
        // Then, for each thread starter, find all related messages
        threadStarters.forEach(starter => {
            if (starter.threadId) {
                const threadMessages = organizedMessages.filter(
                    msg => msg.threadId === starter.threadId
                );
                threadMap.set(starter.threadId, threadMessages);
            }
        });
        
        // Now, replace thread replies with thread summary
        const nonThreadMessages = organizedMessages.filter(
            msg => !msg.threadId || (msg.threadId && !msg.parentId)
        );
        
        organizedMessages = nonThreadMessages;
    }
    
    // Sort by timestamp
    organizedMessages = organizedMessages.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const renderMessage = (message: EnhancedMessage) => {
        // Skip rendering if message has no content
        if (!message.content && message.status !== 'error') {
            return null;
        }
        
        const messageClass = `message ${message.type} ${message.status || ''} ${message.isTyping ? 'typing' : ''}`;
        const senderDisplay = message.isVPResponse ? 'VP of Engineering' : message.sender;
        
        // Check if this is a thread starter with replies
        const isThreadStarter = message.threadId && !message.parentId;
        const threadReplies = isThreadStarter ? 
            messages.filter(m => m.threadId === message.threadId && m.id !== message.id) : 
            [];
        const hasReplies = threadReplies.length > 0;
        
        return (
            <div 
                key={message.id} 
                className={messageClass}
                data-vp={message.isVPResponse ? "true" : "false"}
                data-thread={message.threadId ? "true" : "false"}
                data-has-replies={hasReplies ? "true" : "false"}
            >
                <div className="message-header">
                    <div className="message-sender-info">
                        <span className="sender">{senderDisplay}</span>
                        {message.type === 'agent' && message.agentContext && (
                            <span className="sender-role">{message.agentContext.role}</span>
                        )}
                    </div>
                    <span className="timestamp">
                        {new Date(message.timestamp).toLocaleString()}
                    </span>
                </div>
                <div className="message-content">
                    {message.status === 'error' ? (
                        <div className="error-content">
                            <span className="error-icon">⚠️</span>
                            <span>{message.content}</span>
                        </div>
                    ) : message.isTyping ? (
                        <div className="typing-indicator">
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                        </div>
                    ) : (
                        <div className="message-text">
                            {/* Direct message indicator */}
                            {(() => {
                                const enhancedMsg = message as EnhancedMessage;
                                const directTo = enhancedMsg.directTo;
                                
                                if (!directTo) return null;
                                
                                return (
                                    <div className="message-direction-indicator direct">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="22" y1="2" x2="11" y2="13"></line>
                                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                        </svg>
                                        <span>Direct message to {
                                            (() => {
                                                const targetAgent = agents.find(a => a.id === directTo);
                                                return targetAgent ? (targetAgent.name || targetAgent.role) : 'agent';
                                            })()
                                        }</span>
                                    </div>
                                );
                            })()}
                            
                            {/* Group message indicator */}
                            {(() => {
                                const enhancedMsg = message as EnhancedMessage;
                                const recipientIds = enhancedMsg.recipientIds;
                                const hasRecipients = recipientIds && Array.isArray(recipientIds) && recipientIds.length > 0;
                                
                                return hasRecipients && (
                                    <div className="message-direction-indicator group">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                            <circle cx="9" cy="7" r="4"></circle>
                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                        </svg>
                                        <span>Group message to {hasRecipients ? recipientIds.length : 0} agents</span>
                                    </div>
                                );
                            })()}
                            
                            <MarkdownRenderer content={message.content || ''} />
                            
                            {/* Render attachments if any */}
                            {message.attachments && message.attachments.length > 0 && (
                                <div className="message-attachments">
                                    {message.attachments.map((attachment, index) => (
                                        <AttachmentRenderer 
                                            key={`${message.id}-attachment-${index}`} 
                                            attachment={attachment} 
                                        />
                                    ))}
                                </div>
                            )}
                            
                            {message.type === 'agent' && message.agentContext?.backstory && (
                                <div className="agent-context-tooltip">
                                    <div className="tooltip-icon" title="Agent backstory">i</div>
                                    <div className="tooltip-content">
                                        <h4>{message.agentContext.name || senderDisplay}</h4>
                                        <p className="agent-role">{message.agentContext.role}</p>
                                        <p className="agent-backstory">{message.agentContext.backstory}</p>
                                        {message.agentContext.skills && message.agentContext.skills.length > 0 && (
                                            <div className="agent-skills">
                                                <h5>Skills</h5>
                                                <ul>
                                                    {message.agentContext.skills.map((skill, index) => (
                                                        <li key={index}>{skill}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                
                {/* Message actions (reply, thread view) */}
                {!message.isTyping && (
                    <div className="message-actions">
                        <button 
                            className="message-action-button reply"
                            onClick={() => handleReplyToMessage(message.id, message.threadId)}
                            title="Reply"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 17 4 12 9 7"></polyline>
                                <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
                            </svg>
                        </button>
                        
                        {/* Show thread button only for thread starters */}
                        {isThreadStarter && hasReplies && (
                            <button 
                                className="message-action-button view-thread"
                                onClick={() => handleViewThread(message.threadId!)}
                                title={`View thread (${threadReplies.length} ${threadReplies.length === 1 ? 'reply' : 'replies'})`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                                <span className="reply-count">{threadReplies.length}</span>
                            </button>
                        )}
                    </div>
                )}
                
                {/* Reactions */}
                {message.reactions && message.reactions.length > 0 && (
                    <ReactionControls 
                        reactions={message.reactions}
                        messageId={message.id}
                        currentUserId={currentAgentId}
                        onReact={handleReactToMessage}
                    />
                )}
                
                {/* Show thread summary for thread starters in grouped mode */}
                {groupByThread && isThreadStarter && hasReplies && (
                    <div className="thread-summary" onClick={() => handleViewThread(message.threadId!)}>
                        <div className="thread-summary-count">
                            {threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}
                        </div>
                        <div className="thread-summary-participants">
                            {Array.from(new Set(threadReplies.map(m => m.sender))).slice(0, 3).join(', ')}
                            {threadReplies.length > 3 ? ' and others' : ''}
                        </div>
                        <div className="thread-summary-latest">
                            Latest: {new Date(threadReplies[threadReplies.length - 1].timestamp).toLocaleString()}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="chat-window">
            <div className="chat-container">
                <div className="messages-container" ref={messageListRef}>
                    {organizedMessages.length === 0 ? (
                        <div className="empty-chat">
                            <div className="empty-chat-icon">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 13.4876 3.36093 14.891 4 16.1272V20L7.87279 18.1272C9.10902 18.7663 10.5124 19.1272 12 19.1272C13.4876 19.1272 14.891 18.7663 16.1272 18.1272L20 20V16.1272C20.6391 14.891 21 13.4876 21 12" 
                                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>
                            <div className="empty-chat-text">No messages yet. Start a conversation!</div>
                        </div>
                    ) : (
                        <>
                            {organizedMessages.map(message => renderMessage(message))}
                            <div ref={messagesEndRef} />
                        </>
                    )}
                    
                    {/* Operation Indicator - shows current agent operations */}
                    {messages.find(m => m.currentOperation) && (
                        <OperationIndicator 
                            operation={messages.find(m => m.currentOperation)?.currentOperation} 
                        />
                    )}
                
                    {/* Loading indicator - positioned inside the messages container */}
                    {loadingAgent && (
                        <div className="loading-indicator-container">
                            <div className="loading-indicator">
                                <div className="loading-spinner"></div>
                                <span>
                                    <strong>{loadingAgent}</strong> is working...
                                    {/* Dynamic operation label based on context */}
                                    {(() => {
                                        // We can infer operation type from recent messages or context
                                        const lastMessage = organizedMessages.length > 0 
                                            ? organizedMessages[organizedMessages.length - 1].content?.toLowerCase() 
                                            : '';
                                        
                                        if (lastMessage?.includes('searching') || lastMessage?.includes('looking for')) {
                                            return ' 🔍 Searching files';
                                        } else if (lastMessage?.includes('edit') || lastMessage?.includes('writing')) {
                                            return ' ✏️ Editing code';
                                        } else if (lastMessage?.includes('reading') || lastMessage?.includes('analyzing')) {
                                            return ' 📖 Reading files';
                                        } else if (lastMessage?.includes('running') || lastMessage?.includes('executing')) {
                                            return ' 🚀 Running command';
                                        } else {
                                            return ' 🧠 Processing request';
                                        }
                                    })()}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Message input area */}
                {!disabled && onSendMessage && (
                    <div className="message-composer">
                        {replyingTo && (
                            <div className="replying-to-container">
                                <div className="replying-to-label">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="9 17 4 12 9 7"></polyline>
                                        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
                                    </svg>
                                    <span>Replying to {
                                        messages.find(m => m.id === replyingTo)?.sender || 'message'
                                    }</span>
                                </div>
                                <button 
                                    className="cancel-reply-button"
                                    onClick={() => setReplyingTo(null)}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        )}
                        
                        {!replyingTo && agents.length > 0 && (
                            <div className="recipient-selector">
                                <div className="recipient-dropdown">
                                    <div className="recipient-selection">
                                        {selectedRecipients.length > 0 ? (
                                            <div className="selected-recipients">
                                                {selectedRecipients.map(recipientId => {
                                                    const agent = agents.find(a => a.id === recipientId);
                                                    return (
                                                        <div key={recipientId} className="recipient-tag">
                                                            <span>{agent?.name || agent?.role || 'Agent'}</span>
                                                            <button 
                                                                className="remove-recipient" 
                                                                onClick={() => handleRemoveRecipient(recipientId)}
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                                <input 
                                                    className="recipient-search"
                                                    placeholder={selectedRecipients.length > 0 ? "Add more..." : "Select recipient..."}
                                                    value={recipientSearch}
                                                    onChange={e => setRecipientSearch(e.target.value)}
                                                    onFocus={() => setRecipientDropdownOpen(true)}
                                                />
                                            </div>
                                        ) : (
                                            <input 
                                                className="recipient-search"
                                                placeholder="Select recipient..."
                                                value={recipientSearch}
                                                onChange={e => setRecipientSearch(e.target.value)}
                                                onFocus={() => setRecipientDropdownOpen(true)}
                                            />
                                        )}
                                    </div>
                                    
                                    {recipientDropdownOpen && (
                                        <div className="recipient-options">
                                            <div className="agent-list">
                                                {filteredAgents.length > 0 ? (
                                                    filteredAgents.map(agent => (
                                                        <div 
                                                            key={agent.id} 
                                                            className="agent-option"
                                                            onClick={() => handleSelectRecipient(agent.id)}
                                                        >
                                                            <div className="agent-avatar">
                                                                {(agent.name || agent.role || 'A').charAt(0)}
                                                            </div>
                                                            <div className="agent-info">
                                                                <div className="agent-name">{agent.name || agent.role}</div>
                                                                <div className="agent-role">{agent.role}</div>
                                                            </div>
                                                            {selectedRecipients.includes(agent.id) && (
                                                                <div className="selected-indicator">✓</div>
                                                            )}
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="no-agents-found">No agents match your search</div>
                                                )}
                                            </div>
                                            
                                            {selectedRecipients.length > 0 && (
                                                <div className="recipient-actions">
                                                    <button 
                                                        className="recipient-action clear" 
                                                        onClick={handleClearRecipients}
                                                    >
                                                        Clear All
                                                    </button>
                                                    <button 
                                                        className="recipient-action done" 
                                                        onClick={() => setRecipientDropdownOpen(false)}
                                                    >
                                                        Done
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {selectedRecipients.length > 0 && (
                                    <div className="message-audience">
                                        {selectedRecipients.length === 1 ? (
                                            <span>Direct message</span>
                                        ) : (
                                            <span>Group message ({selectedRecipients.length} agents)</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        <div className="message-input-container">
                            <textarea
                                className="message-input"
                                placeholder={placeholder}
                                value={messageInput}
                                onChange={(e) => setMessageInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }
                                }}
                                disabled={disabled}
                            />
                            <button
                                className="send-button"
                                onClick={handleSendMessage}
                                disabled={!messageInput.trim()}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Thread view sidebar */}
            {activeThreadId && (
                <ThreadView
                    threadId={activeThreadId}
                    messages={messages as EnhancedMessage[]}
                    currentUserId={currentAgentId}
                    agents={agents}
                    onReact={handleReactToMessage}
                    onReply={handleReplyToMessage}
                    onClose={() => setActiveThreadId(null)}
                />
            )}
        </div>
    );
};