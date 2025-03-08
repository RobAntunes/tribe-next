// MightyDev Learning System
// Implements a three-part learning system leveraging CrewAI's memory capabilities

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { TRIBE_FOLDER } from './constants';
import { traceError, traceInfo, traceDebug } from './log/logging';

/**
 * Interface for an Experience
 */
export interface Experience {
    agent_id: string;
    context: string;
    decision: string;
    outcome: string;
    timestamp: string;
    metadata?: Record<string, any>;
}

/**
 * Interface for an Insight
 */
export interface Insight {
    id: string;
    agent_id: string;
    topic: string;
    learning: string;
    confidence: number;
    source_experiences: string[];
    created_at: string;
}

/**
 * Interface for Feedback
 */
export interface Feedback {
    id: string;
    source_id: string;
    target_id: string;
    content: string;
    feedback_type: 'improvement' | 'praise' | 'correction';
    created_at: string;
}

/**
 * Interface for a Reflection
 */
export interface Reflection {
    id: string;
    agent_id: string;
    focus: string;
    insights: string[];
    action_plan: string[];
    created_at: string;
}

/**
 * Learning System class
 * Implements a three-part learning system:
 * 1. External Input - from users and other agents
 * 2. Reflection - internal processing and analysis
 * 3. Feedback - runtime "fine-tuning" through performance feedback
 */
export class LearningSystem {
    private _projectPath: string | undefined;
    private _experiences: Map<string, Experience[]> = new Map();
    private _insights: Map<string, Insight[]> = new Map();
    private _feedback: Map<string, Feedback[]> = new Map();
    private _reflections: Map<string, Reflection[]> = new Map();
    
    constructor(projectPath: string | undefined) {
        this._projectPath = projectPath;
        this._loadState();
    }
    
    /**
     * Capture an experience from an agent
     */
    public async captureExperience(experience: Experience): Promise<boolean> {
        try {
            const { agent_id } = experience;
            
            // Add timestamp if not provided
            if (!experience.timestamp) {
                experience.timestamp = new Date().toISOString();
            }
            
            // Get existing experiences for this agent
            const agentExperiences = this._experiences.get(agent_id) || [];
            
            // Add the new experience
            agentExperiences.push(experience);
            
            // Update the map
            this._experiences.set(agent_id, agentExperiences);
            
            // Save to disk
            await this._saveState();
            
            traceInfo(`Captured experience for agent ${agent_id}`);
            return true;
        } catch (error) {
            traceError('Failed to capture experience:', error);
            return false;
        }
    }
    
    /**
     * Extract patterns from experiences
     */
    public async extractPatterns(agentId: string, topic: string): Promise<Insight | null> {
        try {
            // Get experiences for this agent
            const agentExperiences = this._experiences.get(agentId) || [];
            
            if (agentExperiences.length === 0) {
                traceInfo(`No experiences found for agent ${agentId}`);
                return null;
            }
            
            // In a real implementation, this would use LLM to analyze experiences
            // For now, we'll create a simple insight
            const insightId = `insight-${Date.now()}`;
            const insight: Insight = {
                id: insightId,
                agent_id: agentId,
                topic,
                learning: `Based on analysis of ${agentExperiences.length} experiences, I've learned that...`,
                confidence: 0.8,
                source_experiences: agentExperiences.map(e => e.timestamp),
                created_at: new Date().toISOString()
            };
            
            // Get existing insights for this agent
            const agentInsights = this._insights.get(agentId) || [];
            
            // Add the new insight
            agentInsights.push(insight);
            
            // Update the map
            this._insights.set(agentId, agentInsights);
            
            // Save to disk
            await this._saveState();
            
            traceInfo(`Extracted pattern for agent ${agentId} on topic ${topic}`);
            return insight;
        } catch (error) {
            traceError('Failed to extract patterns:', error);
            return null;
        }
    }
    
    /**
     * Collect feedback from a source to a target
     */
    public async collectFeedback(feedback: Feedback): Promise<boolean> {
        try {
            // Add ID and timestamp if not provided
            if (!feedback.id) {
                feedback.id = `feedback-${Date.now()}`;
            }
            if (!feedback.created_at) {
                feedback.created_at = new Date().toISOString();
            }
            
            // Get existing feedback for this target
            const targetFeedback = this._feedback.get(feedback.target_id) || [];
            
            // Add the new feedback
            targetFeedback.push(feedback);
            
            // Update the map
            this._feedback.set(feedback.target_id, targetFeedback);
            
            // Save to disk
            await this._saveState();
            
            traceInfo(`Collected feedback for target ${feedback.target_id} from ${feedback.source_id}`);
            return true;
        } catch (error) {
            traceError('Failed to collect feedback:', error);
            return false;
        }
    }
    
    /**
     * Create a reflection
     */
    public async createReflection(reflection: Reflection): Promise<boolean> {
        try {
            // Add ID and timestamp if not provided
            if (!reflection.id) {
                reflection.id = `reflection-${Date.now()}`;
            }
            if (!reflection.created_at) {
                reflection.created_at = new Date().toISOString();
            }
            
            // Get existing reflections for this agent
            const agentReflections = this._reflections.get(reflection.agent_id) || [];
            
            // Add the new reflection
            agentReflections.push(reflection);
            
            // Update the map
            this._reflections.set(reflection.agent_id, agentReflections);
            
            // Save to disk
            await this._saveState();
            
            traceInfo(`Created reflection for agent ${reflection.agent_id}`);
            return true;
        } catch (error) {
            traceError('Failed to create reflection:', error);
            return false;
        }
    }
    
    /**
     * Get all experiences for an agent
     */
    public getExperiences(agentId: string): Experience[] {
        return this._experiences.get(agentId) || [];
    }
    
    /**
     * Get all insights for an agent
     */
    public getInsights(agentId: string): Insight[] {
        return this._insights.get(agentId) || [];
    }
    
    /**
     * Get all feedback for an agent
     */
    public getFeedback(agentId: string): Feedback[] {
        return this._feedback.get(agentId) || [];
    }
    
    /**
     * Get all reflections for an agent
     */
    public getReflections(agentId: string): Reflection[] {
        return this._reflections.get(agentId) || [];
    }
    
    /**
     * Generate a learning summary for an agent
     */
    public async generateLearningSummary(agentId: string): Promise<string> {
        try {
            const insights = this.getInsights(agentId);
            const feedback = this.getFeedback(agentId);
            const reflections = this.getReflections(agentId);
            
            // In a real implementation, this would use LLM to generate a summary
            // For now, we'll create a simple summary
            
            let summary = `# Learning Summary for Agent ${agentId}\n\n`;
            
            if (insights.length > 0) {
                summary += `## Insights (${insights.length})\n\n`;
                insights.forEach(insight => {
                    summary += `- **${insight.topic}**: ${insight.learning} (Confidence: ${insight.confidence * 100}%)\n`;
                });
                summary += '\n';
            }
            
            if (feedback.length > 0) {
                summary += `## Feedback (${feedback.length})\n\n`;
                const praiseFeedback = feedback.filter(f => f.feedback_type === 'praise');
                const improvementFeedback = feedback.filter(f => f.feedback_type === 'improvement');
                const correctionFeedback = feedback.filter(f => f.feedback_type === 'correction');
                
                if (praiseFeedback.length > 0) {
                    summary += `### Praise (${praiseFeedback.length})\n`;
                    praiseFeedback.slice(0, 3).forEach(f => {
                        summary += `- ${f.content}\n`;
                    });
                    summary += '\n';
                }
                
                if (improvementFeedback.length > 0) {
                    summary += `### Areas for Improvement (${improvementFeedback.length})\n`;
                    improvementFeedback.slice(0, 3).forEach(f => {
                        summary += `- ${f.content}\n`;
                    });
                    summary += '\n';
                }
                
                if (correctionFeedback.length > 0) {
                    summary += `### Corrections (${correctionFeedback.length})\n`;
                    correctionFeedback.slice(0, 3).forEach(f => {
                        summary += `- ${f.content}\n`;
                    });
                    summary += '\n';
                }
            }
            
            if (reflections.length > 0) {
                summary += `## Recent Reflections (${reflections.length})\n\n`;
                reflections.slice(0, 3).forEach(reflection => {
                    summary += `### ${reflection.focus}\n\n`;
                    if (reflection.insights.length > 0) {
                        summary += '**Insights:**\n';
                        reflection.insights.forEach(insight => {
                            summary += `- ${insight}\n`;
                        });
                        summary += '\n';
                    }
                    if (reflection.action_plan.length > 0) {
                        summary += '**Action Plan:**\n';
                        reflection.action_plan.forEach(step => {
                            summary += `- ${step}\n`;
                        });
                        summary += '\n';
                    }
                });
            }
            
            return summary;
        } catch (error) {
            traceError('Failed to generate learning summary:', error);
            return 'Error generating learning summary.';
        }
    }
    
    /**
     * Load state from disk
     */
    private async _loadState(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            const learningDir = path.join(this._projectPath, TRIBE_FOLDER, 'learning');
            
            if (!await fs.pathExists(learningDir)) {
                // No learning data yet
                return;
            }
            
            // Load experiences
            const experiencesFile = path.join(learningDir, 'experiences.json');
            if (await fs.pathExists(experiencesFile)) {
                const experiences = await fs.readJson(experiencesFile);
                // Convert array to map
                Object.entries(experiences).forEach(([agentId, agentExperiences]) => {
                    this._experiences.set(agentId, agentExperiences as Experience[]);
                });
            }
            
            // Load insights
            const insightsFile = path.join(learningDir, 'insights.json');
            if (await fs.pathExists(insightsFile)) {
                const insights = await fs.readJson(insightsFile);
                // Convert array to map
                Object.entries(insights).forEach(([agentId, agentInsights]) => {
                    this._insights.set(agentId, agentInsights as Insight[]);
                });
            }
            
            // Load feedback
            const feedbackFile = path.join(learningDir, 'feedback.json');
            if (await fs.pathExists(feedbackFile)) {
                const feedback = await fs.readJson(feedbackFile);
                // Convert array to map
                Object.entries(feedback).forEach(([agentId, agentFeedback]) => {
                    this._feedback.set(agentId, agentFeedback as Feedback[]);
                });
            }
            
            // Load reflections
            const reflectionsFile = path.join(learningDir, 'reflections.json');
            if (await fs.pathExists(reflectionsFile)) {
                const reflections = await fs.readJson(reflectionsFile);
                // Convert array to map
                Object.entries(reflections).forEach(([agentId, agentReflections]) => {
                    this._reflections.set(agentId, agentReflections as Reflection[]);
                });
            }
            
            traceInfo('Loaded learning system state');
        } catch (error) {
            traceError('Failed to load learning system state:', error);
        }
    }
    
    /**
     * Save state to disk
     */
    private async _saveState(): Promise<void> {
        try {
            if (!this._projectPath) {
                return;
            }
            
            const learningDir = path.join(this._projectPath, TRIBE_FOLDER, 'learning');
            await fs.ensureDir(learningDir);
            
            // Save experiences
            const experiencesFile = path.join(learningDir, 'experiences.json');
            const experiencesObj = Object.fromEntries(this._experiences);
            await fs.writeJson(experiencesFile, experiencesObj, { spaces: 2 });
            
            // Save insights
            const insightsFile = path.join(learningDir, 'insights.json');
            const insightsObj = Object.fromEntries(this._insights);
            await fs.writeJson(insightsFile, insightsObj, { spaces: 2 });
            
            // Save feedback
            const feedbackFile = path.join(learningDir, 'feedback.json');
            const feedbackObj = Object.fromEntries(this._feedback);
            await fs.writeJson(feedbackFile, feedbackObj, { spaces: 2 });
            
            // Save reflections
            const reflectionsFile = path.join(learningDir, 'reflections.json');
            const reflectionsObj = Object.fromEntries(this._reflections);
            await fs.writeJson(reflectionsFile, reflectionsObj, { spaces: 2 });
            
            traceInfo('Saved learning system state');
        } catch (error) {
            traceError('Failed to save learning system state:', error);
        }
    }
}