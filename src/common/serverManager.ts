import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import { CrewAIExtension } from './crewAIExtension';
import { traceError, traceInfo, traceDebug } from './log/logging';

// We need to import this type from the webview
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

// Event names for notifications
export const SERVER_EVENTS = {
    AGENT_MESSAGE: 'agent_message',
    TASK_COMPLETED: 'task_completed',
    TASK_STARTED: 'task_started',
    TASK_FAILED: 'task_failed',
    CODE_CHANGE_PROPOSED: 'code_change_proposed',
    AGENT_THINKING: 'agent_thinking',
    AGENT_IDLE: 'agent_idle',
    AGENT_CREATED: 'agent_created',
    TEAM_CREATED: 'team_created',
    CONFIRMATION_NEEDED: 'confirmation_needed',
    HUMAN_INPUT_NEEDED: 'human_input_needed',
    ERROR: 'error',
};

/**
 * ServerManager class to handle interactions with the Python server
 */
export class ServerManager {
    private _crewAIExtension: CrewAIExtension;
    private _socket: net.Socket | undefined;
    private _serverPort: number | undefined;
    private _serverProcess: any;
    private _connected: boolean = false;
    private _notifications: Notification[] = [];
    private _eventListeners: Map<string, ((data: any) => void)[]> = new Map();
    private _notificationListeners: ((notifications: Notification[]) => void)[] = [];
    
    constructor(private readonly _context: vscode.ExtensionContext) {
        this._crewAIExtension = new CrewAIExtension(this._context);
        
        // Initialize event listeners map for all event types
        Object.values(SERVER_EVENTS).forEach(eventName => {
            this._eventListeners.set(eventName, []);
        });
    }
    
    /**
     * Start the server
     */
    public async startServer(projectPath: string): Promise<boolean> {
        try {
            const started = await this._crewAIExtension.startServer(projectPath);
            if (!started) {
                traceError('Failed to start server');
                this._addNotification({
                    id: `error-${Date.now()}`,
                    type: 'alert',
                    message: 'Failed to start CrewAI server',
                    timestamp: new Date(),
                    read: false,
                    priority: 'high'
                });
                return false;
            }
            
            this._connected = true;
            this._addNotification({
                id: `server-started-${Date.now()}`,
                type: 'success',
                message: 'CrewAI server started successfully',
                timestamp: new Date(),
                read: false
            });
            
            // Setup event listeners for the server
            this._setupEventListeners();
            
            return true;
        } catch (error) {
            traceError('Error starting server:', error);
            this._connected = false;
            this._addNotification({
                id: `error-${Date.now()}`,
                type: 'alert',
                message: `Error starting CrewAI server: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date(),
                read: false,
                priority: 'high'
            });
            return false;
        }
    }
    
    /**
     * Send a request to the server
     */
    public async sendRequest(command: string, payload: any): Promise<any> {
        try {
            if (!this._connected) {
                traceError('Cannot send request: Not connected to server');
                throw new Error('Not connected to server');
            }
            
            return await this._crewAIExtension.sendRequest(command, payload);
        } catch (error) {
            traceError('Error sending request to server:', error);
            this._addNotification({
                id: `request-error-${Date.now()}`,
                type: 'alert',
                message: `Error sending request to server: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date(),
                read: false
            });
            throw error;
        }
    }
    
    /**
     * Stop the server
     */
    public async stopServer(): Promise<void> {
        try {
            await this._crewAIExtension.stopServer();
            this._connected = false;
            this._addNotification({
                id: `server-stopped-${Date.now()}`,
                type: 'info',
                message: 'CrewAI server stopped',
                timestamp: new Date(),
                read: false
            });
        } catch (error) {
            traceError('Error stopping server:', error);
            this._addNotification({
                id: `error-${Date.now()}`,
                type: 'alert',
                message: `Error stopping CrewAI server: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date(),
                read: false
            });
        }
    }
    
    /**
     * Check if the server is connected
     */
    public isConnected(): boolean {
        return this._connected;
    }
    
    /**
     * Setup event listeners for server events
     */
    private _setupEventListeners(): void {
        // In a real implementation, this would listen for events from the server
        // For now, we'll just set up handlers for when we manually trigger events
    }
    
    /**
     * Add a notification
     */
    private _addNotification(notification: Notification): void {
        this._notifications.push(notification);
        this._notifyNotificationListeners();
        
        // Emit relevant event based on notification type
        let eventName: string | undefined;
        switch (notification.type) {
            case 'message':
                eventName = SERVER_EVENTS.AGENT_MESSAGE;
                break;
            case 'code':
                eventName = SERVER_EVENTS.CODE_CHANGE_PROPOSED;
                break;
            case 'confirmation':
                eventName = SERVER_EVENTS.CONFIRMATION_NEEDED;
                break;
            case 'alert':
                eventName = SERVER_EVENTS.ERROR;
                break;
        }
        
        if (eventName) {
            this._emitEvent(eventName, notification);
        }
    }
    
    /**
     * Mark a notification as read
     */
    public markNotificationAsRead(notificationId: string): void {
        const notification = this._notifications.find(n => n.id === notificationId);
        if (notification) {
            notification.read = true;
            this._notifyNotificationListeners();
        }
    }
    
    /**
     * Get all notifications
     */
    public getNotifications(): Notification[] {
        return [...this._notifications];
    }
    
    /**
     * Clear all notifications
     */
    public clearNotifications(): void {
        this._notifications = [];
        this._notifyNotificationListeners();
    }
    
    /**
     * Dismiss a notification
     */
    public dismissNotification(notificationId: string): void {
        this._notifications = this._notifications.filter(n => n.id !== notificationId);
        this._notifyNotificationListeners();
    }
    
    /**
     * Add event listener
     */
    public addEventListener(eventName: string, listener: (data: any) => void): void {
        const listeners = this._eventListeners.get(eventName) || [];
        listeners.push(listener);
        this._eventListeners.set(eventName, listeners);
    }
    
    /**
     * Remove event listener
     */
    public removeEventListener(eventName: string, listener: (data: any) => void): void {
        const listeners = this._eventListeners.get(eventName) || [];
        const index = listeners.indexOf(listener);
        if (index !== -1) {
            listeners.splice(index, 1);
            this._eventListeners.set(eventName, listeners);
        }
    }
    
    /**
     * Emit an event
     */
    private _emitEvent(eventName: string, data: any): void {
        const listeners = this._eventListeners.get(eventName) || [];
        listeners.forEach(listener => {
            try {
                listener(data);
            } catch (error) {
                traceError(`Error in event listener for ${eventName}:`, error);
            }
        });
    }
    
    /**
     * Add notification listener
     */
    public addNotificationListener(listener: (notifications: Notification[]) => void): void {
        this._notificationListeners.push(listener);
        // Immediately notify with current notifications
        listener([...this._notifications]);
    }
    
    /**
     * Remove notification listener
     */
    public removeNotificationListener(listener: (notifications: Notification[]) => void): void {
        const index = this._notificationListeners.indexOf(listener);
        if (index !== -1) {
            this._notificationListeners.splice(index, 1);
        }
    }
    
    /**
     * Notify all notification listeners
     */
    private _notifyNotificationListeners(): void {
        const notifications = [...this._notifications];
        this._notificationListeners.forEach(listener => {
            try {
                listener(notifications);
            } catch (error) {
                traceError('Error in notification listener:', error);
            }
        });
    }
    
    /**
     * Create a confirmation notification
     */
    public createConfirmation(message: string, source: string, actions: { confirm: string, cancel: string }, priority: 'low' | 'medium' | 'high' = 'medium'): string {
        const id = `confirmation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const notification: Notification = {
            id,
            type: 'confirmation',
            message,
            timestamp: new Date(),
            read: false,
            source,
            priority,
            requiresAction: true,
            actions
        };
        
        this._notifications.push(notification);
        this._notifyNotificationListeners();
        this._emitEvent(SERVER_EVENTS.CONFIRMATION_NEEDED, notification);
        
        return id;
    }
    
    /**
     * Handle a notification action
     */
    public handleNotificationAction(notificationId: string, action: string): void {
        const notification = this._notifications.find(n => n.id === notificationId);
        if (notification) {
            // Mark as read
            notification.read = true;
            notification.requiresAction = false;
            
            // Emit event for the action
            this._emitEvent(`${notification.type}_action`, { notification, action });
            
            // Update notifications
            this._notifyNotificationListeners();
        }
    }
    
    /**
     * Human-in-the-loop confirmation
     * This returns a promise that resolves when the user takes an action
     */
    public async requestHumanConfirmation(
        message: string, 
        source: string = 'System', 
        confirmText: string = 'Confirm', 
        cancelText: string = 'Cancel',
        priority: 'low' | 'medium' | 'high' = 'medium'
    ): Promise<boolean> {
        return new Promise((resolve) => {
            const notificationId = this.createConfirmation(
                message,
                source,
                { confirm: confirmText, cancel: cancelText },
                priority
            );
            
            // Add one-time event listeners for this specific confirmation
            const confirmationHandler = (data: any) => {
                if (data.notification.id === notificationId) {
                    // Remove the event listener
                    this.removeEventListener('confirmation_action', confirmationHandler);
                    
                    // Resolve based on the action
                    resolve(data.action === 'confirm');
                }
            };
            
            this.addEventListener('confirmation_action', confirmationHandler);
        });
    }
    
    /**
     * Dispose method to clean up resources
     */
    public dispose(): void {
        this.stopServer();
    }
}