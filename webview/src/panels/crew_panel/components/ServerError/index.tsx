/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/** @jsxRuntime classic */

import React from "react";
import { AlertTriangle, RefreshCw, Settings, Key } from "lucide-react";
import { getVsCodeApi } from '../../../../vscode';
import "./styles.css";

interface ServerErrorProps {
    message: string;
    canRetry: boolean;
    action?: string;
    actionPayload?: any;
    errorType?: 'api_key' | 'dependency' | 'server' | 'unknown';
    onClose?: () => void;
}

export const ServerError: React.FC<ServerErrorProps> = ({ 
    message, 
    canRetry, 
    action, 
    actionPayload,
    errorType = 'unknown',
    onClose 
}) => {
    const vscode = getVsCodeApi();

    const handleRetry = () => {
        if (action && actionPayload) {
            vscode.postMessage({
                type: action,
                payload: actionPayload
            });
        }
        
        if (onClose) {
            onClose();
        }
    };

    const handleOpenSettings = () => {
        // Direct user to the Environment Manager tab
        vscode.postMessage({
            type: 'OPEN_ENV_MANAGER'
        });
        
        if (onClose) {
            onClose();
        }
    };

    const handleRunSetup = () => {
        // Ask VSCode to run the setup script
        vscode.postMessage({
            type: 'RUN_SETUP'
        });
        
        if (onClose) {
            onClose();
        }
    };

    const handleClose = () => {
        if (onClose) {
            onClose();
        }
    };

    // Determine error tip and actions based on error type
    let errorTip = '';
    let errorActions = null;

    switch(errorType) {
        case 'api_key':
            errorTip = 'This error is related to missing or invalid API keys. You need to configure your API keys in the Environment Manager.';
            errorActions = (
                React.Fragment && (
                    <React.Fragment>
                        <button className="server-error-button settings" onClick={handleOpenSettings}>
                            <Settings size={16} />
                            Open Environment Manager
                        </button>
                        {canRetry && (
                            <button className="server-error-button retry" onClick={handleRetry}>
                                <RefreshCw size={16} />
                                Retry
                            </button>
                        )}
                    </React.Fragment>
                )
            );
            break;
        case 'dependency':
            errorTip = 'This error is related to missing Python dependencies. Run the setup script to install all required packages.';
            errorActions = (
                React.Fragment && (
                    <React.Fragment>
                        <button className="server-error-button setup" onClick={handleRunSetup}>
                            <Key size={16} />
                            Run Setup Script
                        </button>
                        {canRetry && (
                            <button className="server-error-button retry" onClick={handleRetry}>
                                <RefreshCw size={16} />
                                Retry
                            </button>
                        )}
                    </React.Fragment>
                )
            );
            break;
        case 'server':
        default:
            errorTip = 'Make sure the CrewAI server is running and has all required dependencies.';
            errorActions = (
                React.Fragment && (
                    <React.Fragment>
                        {canRetry && (
                            <button className="server-error-button retry" onClick={handleRetry}>
                                <RefreshCw size={16} />
                                Retry
                            </button>
                        )}
                    </React.Fragment>
                )
            );
    }

    return (
        <div className="server-error-overlay">
            <div className="server-error-container">
                <div className="server-error-icon">
                    <AlertTriangle size={40} color="#e67e22" />
                </div>
                <div className="server-error-content">
                    <h3 className="server-error-title">Server Error</h3>
                    <p className="server-error-message">{message}</p>
                    <p className="server-error-tip">{errorTip}</p>
                    <div className="server-error-actions">
                        {errorActions}
                        <button className="server-error-button close" onClick={handleClose}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};