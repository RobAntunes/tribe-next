import React, { useState, useEffect, useRef } from 'react';
import { 
    Bell, 
    CheckCircle, 
    AlertTriangle, 
    Info, 
    MessageSquare, 
    Code, 
    FileText, 
    ThumbsUp,
    X, 
    Check, 
    Filter, 
    Search, 
    MoreVertical,
    Settings
} from 'lucide-react';

export interface Notification {
    id: string;
    type: 'alert' | 'info' | 'success' | 'message' | 'code' | 'file' | 'feedback' | 'confirmation';
    message: string;
    timestamp: Date;
    read: boolean;
    source?: string; // Agent or system that generated this notification
    category?: string; // For grouping/filtering
    priority?: 'low' | 'medium' | 'high';
    relatedItemId?: string; // For linking to a specific item
    requiresAction?: boolean; // For confirmation notifications
    actions?: {
        confirm?: string;
        cancel?: string;
        defer?: string;
    };
    metadata?: Record<string, any>; // Additional data
}

interface NotificationCenterProps {
    notifications: Notification[];
    onNotificationRead: (id: string) => void;
    onNotificationAction?: (id: string, action: string) => void;
    onClearAll?: () => void;
    onNotificationDismiss?: (id: string) => void;
    preferenceSettings?: NotificationPreferences;
    onUpdatePreferences?: (preferences: NotificationPreferences) => void;
}

export interface NotificationPreferences {
    enabledTypes: string[];
    enabledCategories: string[];
    showUnreadOnly: boolean;
    autoDismissAfter: number; // milliseconds, 0 means never auto-dismiss
    confirmationBehavior: 'always' | 'important' | 'never';
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ 
    notifications, 
    onNotificationRead, 
    onNotificationAction, 
    onClearAll,
    onNotificationDismiss,
    preferenceSettings,
    onUpdatePreferences
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [showSettings, setShowSettings] = useState(false);
    const [localPreferences, setLocalPreferences] = useState<NotificationPreferences>({
        enabledTypes: ['alert', 'info', 'success', 'message', 'code', 'file', 'feedback', 'confirmation'],
        enabledCategories: [],
        showUnreadOnly: false,
        autoDismissAfter: 10000, // 10 seconds
        confirmationBehavior: 'important'
    });
    const notificationRef = useRef<HTMLDivElement>(null);

    // Use the provided preferences or the local defaults
    const preferences = preferenceSettings || localPreferences;

    useEffect(() => {
        // Close the notification center when clicking outside of it
        function handleClickOutside(event: MouseEvent) {
            if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const unreadCount = notifications.filter(n => !n.read).length;

    // Filter and search notifications
    const filteredNotifications = notifications
        .filter(notification => {
            // Filter by type/read status
            if (filter === 'unread' && notification.read) return false;
            if (filter !== 'all' && filter !== 'unread' && notification.type !== filter) return false;
            
            // Filter by preference settings
            if (!preferences.enabledTypes.includes(notification.type)) return false;
            if (preferences.showUnreadOnly && notification.read) return false;
            if (preferences.enabledCategories.length > 0 && 
                notification.category && 
                !preferences.enabledCategories.includes(notification.category)) return false;
                
            // Filter by search term
            if (searchTerm && !notification.message.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            
            return true;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Find notifications requiring confirmation
    const confirmationNotifications = notifications.filter(
        n => n.requiresAction && !n.read && n.type === 'confirmation'
    );

    // Get unique categories from notifications
    const categories = [...new Set(notifications.filter(n => n.category).map(n => n.category))];

    // Handle notification action
    const handleAction = (id: string, action: string) => {
        if (onNotificationAction) {
            onNotificationAction(id, action);
        }
        // Mark as read after action
        onNotificationRead(id);
    };

    // Update preferences
    const updatePreference = (key: keyof NotificationPreferences, value: any) => {
        const updatedPreferences = { ...preferences, [key]: value };
        setLocalPreferences(updatedPreferences);
        if (onUpdatePreferences) {
            onUpdatePreferences(updatedPreferences);
        }
    };

    // Toggle notification type in enabled types
    const toggleNotificationType = (type: string) => {
        const types = [...preferences.enabledTypes];
        if (types.includes(type)) {
            updatePreference('enabledTypes', types.filter(t => t !== type));
        } else {
            updatePreference('enabledTypes', [...types, type]);
        }
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'alert': return <AlertTriangle className="w-4 h-4 text-red-500" />;
            case 'info': return <Info className="w-4 h-4 text-blue-500" />;
            case 'message': return <MessageSquare className="w-4 h-4 text-purple-500" />;
            case 'code': return <Code className="w-4 h-4 text-yellow-500" />;
            case 'file': return <FileText className="w-4 h-4 text-gray-500" />;
            case 'feedback': return <ThumbsUp className="w-4 h-4 text-indigo-500" />;
            case 'confirmation': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
            default: return <Info className="w-4 h-4 text-blue-500" />;
        }
    };

    return (
        <div className="notification-center relative" ref={notificationRef}>
            <div 
                className="notification-badge cursor-pointer p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                onClick={() => setIsOpen(!isOpen)}
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="notification-count absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                        {unreadCount}
                    </span>
                )}
            </div>
            
            {/* Confirmation notifications that float above everything else */}
            {confirmationNotifications.length > 0 && preferences.confirmationBehavior !== 'never' && (
                <div className="fixed top-4 right-4 z-50 max-w-sm">
                    {confirmationNotifications
                        .filter(n => preferences.confirmationBehavior === 'always' || 
                                 (preferences.confirmationBehavior === 'important' && n.priority === 'high'))
                        .map(notification => (
                            <div key={notification.id} className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 mb-3 border-l-4 border-orange-500 flex flex-col">
                                <div className="flex justify-between items-start">
                                    <div className="flex">
                                        {getNotificationIcon(notification.type)}
                                        <div className="ml-2 font-semibold">{notification.source || 'System'}</div>
                                    </div>
                                    <button 
                                        onClick={() => onNotificationDismiss && onNotificationDismiss(notification.id)}
                                        className="text-gray-400 hover:text-gray-500"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="my-2">{notification.message}</div>
                                <div className="flex justify-end gap-2 mt-2">
                                    {notification.actions?.cancel && (
                                        <button 
                                            onClick={() => handleAction(notification.id, 'cancel')}
                                            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-md text-sm"
                                        >
                                            {notification.actions.cancel}
                                        </button>
                                    )}
                                    {notification.actions?.defer && (
                                        <button 
                                            onClick={() => handleAction(notification.id, 'defer')}
                                            className="px-3 py-1 bg-gray-300 dark:bg-gray-600 rounded-md text-sm"
                                        >
                                            {notification.actions.defer}
                                        </button>
                                    )}
                                    {notification.actions?.confirm && (
                                        <button 
                                            onClick={() => handleAction(notification.id, 'confirm')}
                                            className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm"
                                        >
                                            {notification.actions.confirm}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                </div>
            )}
            
            {/* Main notification panel */}
            {isOpen && (
                <div className="notification-panel absolute right-0 mt-2 w-80 max-h-96 bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden z-40">
                    <div className="notification-header p-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <div className="text-lg font-semibold">Notifications</div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setShowSettings(!showSettings)}
                                className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Notification Settings"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                            {onClearAll && (
                                <button 
                                    onClick={onClearAll}
                                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {/* Filters and search */}
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1">
                                <button 
                                    className={`px-2 py-1 text-xs rounded-md ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    onClick={() => setFilter('all')}
                                >
                                    All
                                </button>
                                <button 
                                    className={`px-2 py-1 text-xs rounded-md ${filter === 'unread' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    onClick={() => setFilter('unread')}
                                >
                                    Unread
                                </button>
                                <div className="relative">
                                    <button 
                                        className={`px-2 py-1 text-xs rounded-md flex items-center gap-1 ${filter !== 'all' && filter !== 'unread' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                                        onClick={() => {}} // Show dropdown in a real implementation
                                    >
                                        <Filter className="w-3 h-3" />
                                        <span>Filter</span>
                                    </button>
                                    {/* Filter dropdown would go here */}
                                </div>
                            </div>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="text-xs p-1 pl-6 w-24 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                />
                                <Search className="w-3 h-3 absolute left-2 top-1.5 text-gray-400" />
                            </div>
                        </div>
                    </div>
                    
                    {/* Settings panel */}
                    {showSettings && (
                        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-sm font-semibold mb-2">Notification Settings</h3>
                            
                            <div className="mb-3">
                                <div className="text-xs font-medium mb-1">Notification Types</div>
                                <div className="flex flex-wrap gap-1">
                                    {['alert', 'info', 'success', 'message', 'code', 'confirmation'].map(type => (
                                        <button
                                            key={type}
                                            onClick={() => toggleNotificationType(type)}
                                            className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
                                                preferences.enabledTypes.includes(type) 
                                                ? 'bg-blue-500 text-white' 
                                                : 'bg-gray-200 dark:bg-gray-700'
                                            }`}
                                        >
                                            {getNotificationIcon(type)}
                                            <span className="capitalize">{type}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="mb-3">
                                <div className="text-xs font-medium mb-1">Confirmation Behavior</div>
                                <select
                                    value={preferences.confirmationBehavior}
                                    onChange={(e) => updatePreference('confirmationBehavior', e.target.value)}
                                    className="w-full text-xs p-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                >
                                    <option value="always">Always show confirmations</option>
                                    <option value="important">Only show important confirmations</option>
                                    <option value="never">Never show confirmations</option>
                                </select>
                            </div>
                            
                            <div className="mb-3">
                                <div className="text-xs font-medium mb-1">Auto-dismiss after</div>
                                <select
                                    value={preferences.autoDismissAfter}
                                    onChange={(e) => updatePreference('autoDismissAfter', Number(e.target.value))}
                                    className="w-full text-xs p-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                >
                                    <option value="0">Never auto-dismiss</option>
                                    <option value="5000">5 seconds</option>
                                    <option value="10000">10 seconds</option>
                                    <option value="30000">30 seconds</option>
                                    <option value="60000">1 minute</option>
                                </select>
                            </div>
                            
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="show-unread-only"
                                    checked={preferences.showUnreadOnly}
                                    onChange={(e) => updatePreference('showUnreadOnly', e.target.checked)}
                                    className="mr-2"
                                />
                                <label htmlFor="show-unread-only" className="text-xs">Show unread notifications only</label>
                            </div>
                        </div>
                    )}
                    
                    {/* Notification list */}
                    <div className="notification-list max-h-80 overflow-y-auto">
                        {filteredNotifications.length > 0 ? (
                            filteredNotifications.map(notification => (
                                <div 
                                    key={notification.id} 
                                    className={`notification-item p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer ${notification.read ? 'opacity-70' : 'opacity-100'}`}
                                    onClick={() => onNotificationRead(notification.id)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex">
                                            {getNotificationIcon(notification.type)}
                                            <div className="ml-2 text-xs text-gray-500">{notification.source || 'System'}</div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {notification.priority === 'high' && (
                                                <span className="bg-red-100 text-red-600 text-xs px-1 rounded">High</span>
                                            )}
                                            <div className="flex">
                                                {onNotificationDismiss && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onNotificationDismiss(notification.id);
                                                        }}
                                                        className="text-gray-400 hover:text-gray-500"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                )}
                                                <div className="text-xs text-gray-400 ml-1">
                                                    {new Date(notification.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-1 text-sm">{notification.message}</div>
                                    {notification.requiresAction && notification.actions && (
                                        <div className="flex justify-end gap-2 mt-2">
                                            {notification.actions.cancel && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAction(notification.id, 'cancel');
                                                    }}
                                                    className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-md"
                                                >
                                                    {notification.actions.cancel}
                                                </button>
                                            )}
                                            {notification.actions.confirm && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAction(notification.id, 'confirm');
                                                    }}
                                                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded-md"
                                                >
                                                    {notification.actions.confirm}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-sm">
                                {searchTerm ? 'No matching notifications' : 'No notifications'}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationCenter;
