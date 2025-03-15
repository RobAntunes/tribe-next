// MightyDev Learning System
// Implements a three-part learning system leveraging CrewAI's memory capabilities

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { TRIBE_FOLDER } from './constants';
import { traceError, traceInfo, traceDebug } from './log/logging';
import { CrewAIExtension } from './crewAIExtension';
import { storeMemory, getProjectMetadata } from './utilities';

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
     * Create a reflection specifically to analyze and improve responses
     * This implements the ability for the model to reflect on its own responses
     * both before and after generating them
     * 
     * @param agentId Agent ID to create reflection for
     * @param content Content to reflect on
     * @param focus Focus area for reflection (e.g., 'Response Quality', 'Code Generation', etc.)
     * @param stage 'pre' for before generating a response, 'post' for after
     */
    public async createResponseReflection(
        agentId: string, 
        _content: string, 
        focus: string = 'Response Quality',
        stage: 'pre' | 'post' = 'post'
    ): Promise<Reflection | null> {
        try {
            // Define reflection framework based on stage
            let insights: string[] = [];
            let actionPlan: string[] = [];
            
            if (stage === 'pre') {
                // Pre-response reflection (before generating a response)
                insights = [
                    `Based on the query, the user seems to need detailed explanations of concepts X and Y`,
                    `The user may need examples for clarity based on their prior questions`,
                    `This query requires both high-level explanation and technical details`
                ];
                
                actionPlan = [
                    `Start with a clear, concise overview before diving into technical details`,
                    `Include practical examples that demonstrate the concepts in action`,
                    `Structure the response with clear headings and code examples where appropriate`
                ];
            } else {
                // Post-response reflection (after generating a response)
                // In a real implementation, this would analyze the actual content
                insights = [
                    `The response addresses key points but could be more concise in sections A and B`,
                    `The explanation provides good technical depth but uses terminology that may be unclear`,
                    `Code examples are helpful but could benefit from more comments explaining the logic`
                ];
                
                actionPlan = [
                    `In future responses, focus on more concise explanations while maintaining depth`,
                    `Define technical terms when first introduced or use simpler alternatives`,
                    `Add more descriptive comments to code examples to explain the "why" not just the "what"`
                ];
            }
            
            const reflection: Reflection = {
                id: `reflection-${Date.now()}-${stage}`,
                agent_id: agentId,
                focus: `${focus} (${stage === 'pre' ? 'Pre-Response' : 'Post-Response'})`,
                insights,
                action_plan: actionPlan,
                created_at: new Date().toISOString()
            };
            
            // Save the reflection
            await this.createReflection(reflection);
            
            // In a real implementation, this would be used to improve the model's responses
            // by applying the insights and action plan
            traceInfo(`Created ${stage}-response reflection for agent ${agentId} on ${focus}`);
            return reflection;
        } catch (error) {
            traceError('Failed to create response reflection:', error);
            return null;
        }
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
            
            // Store the summary in the memory system
            if (this._projectPath) {
                await storeMemory(
                    this._projectPath,
                    'reflection',
                    {
                        agent_id: agentId,
                        summary,
                        insights: insights.length,
                        feedback: feedback.length,
                        reflections: reflections.length,
                        content: summary
                    }
                );
            }
            
            return summary;
        } catch (error) {
            traceError('Failed to generate learning summary:', error);
            return 'Error generating learning summary.';
        }
    }
    
    /**
     * Get learning summary as metadata for CrewAI agent prompts
     * This is used to connect the learning system with CrewAI's memory
     * @param agentId Agent ID to get learning for
     */
    public async getLearningSummaryAsMetadata(agentId: string): Promise<string> {
        try {
            const insights = this.getInsights(agentId);
            const feedback = this.getFeedback(agentId);
            const reflections = this.getReflections(agentId);
            
            // Create a comprehensive but concise summary that can be attached to agent prompts
            let metadata = `# Real-Time Learning Context\n`;
            
            // Add key insights
            if (insights.length > 0) {
                metadata += `## Key Insights\n`;
                insights
                    .sort((a, b) => b.confidence - a.confidence) // Sort by confidence
                    .slice(0, 3) // Get top 3
                    .forEach(insight => {
                        metadata += `- ${insight.learning}\n`;
                    });
            }
            
            // Add feedback lessons - this will be appended to every message as "real-time fine-tuning"
            if (feedback.length > 0) {
                metadata += `## Feedback For Continuous Improvement\n`;
                
                // Get all types of feedback, prioritizing the most recent
                const recentFeedback = feedback
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 5);
                
                // Get praise feedback for positive reinforcement
                const praiseFeedback = recentFeedback.filter(f => f.feedback_type === 'praise');
                if (praiseFeedback.length > 0) {
                    metadata += `### Strengths to Maintain\n`;
                    praiseFeedback.forEach(f => {
                        metadata += `- ${f.content}\n`;
                    });
                }
                
                // Get improvement feedback
                const improvementFeedback = recentFeedback.filter(f => f.feedback_type === 'improvement');
                if (improvementFeedback.length > 0) {
                    metadata += `### Areas to Enhance\n`;
                    improvementFeedback.forEach(f => {
                        metadata += `- ${f.content}\n`;
                    });
                }
                
                // Get correction feedback - highest priority
                const correctionFeedback = recentFeedback.filter(f => f.feedback_type === 'correction');
                if (correctionFeedback.length > 0) {
                    metadata += `### Critical Adjustments (Must Apply)\n`;
                    correctionFeedback.forEach(f => {
                        metadata += `- ${f.content}\n`;
                    });
                }
            }
            
            // Add reflection insights for better self-awareness
            if (reflections.length > 0) {
                metadata += `## Self-Reflection Insights\n`;
                reflections
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 2) // Get top 2 most recent reflections
                    .forEach(reflection => {
                        metadata += `### ${reflection.focus}\n`;
                        if (reflection.insights.length > 0) {
                            reflection.insights.slice(0, 2).forEach(insight => {
                                metadata += `- ${insight}\n`;
                            });
                        }
                        if (reflection.action_plan.length > 0) {
                            metadata += `**Action:** ${reflection.action_plan[0]}\n`;
                        }
                    });
            }
            
            // Add instruction for how to use this feedback in every response
            metadata += `\n## Application Instructions\nApply ALL feedback above to EACH response you generate, especially the critical adjustments. This feedback should be treated as a real-time learning system that continuously improves your outputs. Before submitting any response, verify it incorporates the feedback provided here.\n`;
            
            return metadata;
        } catch (error) {
            traceError('Failed to get learning summary as metadata:', error);
            return '';
        }
    }
    
    /**
     * Create a reflection with CrewAI
     * This method uses the CrewAI server to analyze experiences and create a reflection
     */
    public async createReflectionWithCrewAI(crewaiExtension: CrewAIExtension, agentId: string, topic: string): Promise<Reflection | null> {
        try {
            if (!this._projectPath) {
                throw new Error('Project path not set');
            }
            
            // Get experiences for this agent
            const experiences = this.getExperiences(agentId);
            
            if (experiences.length === 0) {
                traceInfo(`No experiences found for agent ${agentId} to reflect on`);
                return null;
            }
            
            // Structure the experiences for the agent to analyze
            const experiencesText = experiences
                .slice(-10) // Get the last 10 experiences
                .map(e => {
                    return `- Context: ${e.context}\n  Decision: ${e.decision}\n  Outcome: ${e.outcome}`;
                })
                .join('\n\n');
            
            // Send a request to the CrewAI server to analyze the experiences
            const response = await crewaiExtension.sendRequest('send_message', {
                agent_id: agentId,
                message: `Please analyze the following experiences and create a reflection on the topic "${topic}":\n\n${experiencesText}\n\nProvide 3-5 insights from these experiences and a 2-3 step action plan.`
            });
            
            if (response.status === 'completed' && response.response) {
                // Parse the reflection from the response
                const reflectionText = response.response;
                
                // Extract insights and action plan
                const insightsMatch = reflectionText.match(/Insights:([\s\S]*?)(?:Action Plan:|$)/i);
                const actionPlanMatch = reflectionText.match(/Action Plan:([\s\S]*?)(?:$)/i);
                
                const insights = insightsMatch ? 
                    insightsMatch[1].split('\n')
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.startsWith('-') || line.startsWith('*'))
                        .map((line: string) => line.replace(/^[*-]\s*/, ''))
                        .filter((line: string) => line.length > 0) : 
                    [];
                
                const actionPlan = actionPlanMatch ? 
                    actionPlanMatch[1].split('\n')
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.startsWith('-') || line.startsWith('*'))
                        .map((line: string) => line.replace(/^[*-]\s*/, ''))
                        .filter((line: string) => line.length > 0) : 
                    [];
                
                // Create the reflection
                const reflection: Reflection = {
                    id: `reflection-${Date.now()}`,
                    agent_id: agentId,
                    focus: topic,
                    insights,
                    action_plan: actionPlan,
                    created_at: new Date().toISOString()
                };
                
                // Save the reflection
                await this.createReflection(reflection);
                
                // Store in the project memory system
                await storeMemory(
                    this._projectPath,
                    'reflection',
                    {
                        agent_id: agentId,
                        focus: topic,
                        insights: insights.join('\n'),
                        action_plan: actionPlan.join('\n'),
                        content: reflectionText
                    }
                );
                
                traceInfo(`Created reflection for agent ${agentId} on topic ${topic}`);
                return reflection;
            } else {
                traceError('Failed to get reflection from CrewAI:', response);
                return null;
            }
        } catch (error) {
            traceError('Failed to create reflection with CrewAI:', error);
            return null;
        }
    }
    
    /**
     * Add agent learning to CrewAI prompt
     * This method prepares a context section to be added to agent prompts
     */
    public async getAgentLearningContext(agentId: string): Promise<string> {
        try {
            // Get insights, reflections and recent feedback
            const insights = this.getInsights(agentId).sort((a, b) => {
                // Sort by confidence and then by date
                if (b.confidence !== a.confidence) {
                    return b.confidence - a.confidence;
                }
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }).slice(0, 5);
            
            const reflections = this.getReflections(agentId)
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 3);
            
            const feedback = this.getFeedback(agentId)
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 5);
            
            // Construct context
            let context = `## Agent Learning Context\n\n`;
            
            if (insights.length > 0) {
                context += `### Key Insights\n`;
                insights.forEach(insight => {
                    context += `- ${insight.learning}\n`;
                });
                context += '\n';
            }
            
            if (reflections.length > 0) {
                context += `### Recent Reflections\n`;
                reflections.forEach(reflection => {
                    context += `- ${reflection.focus}: ${reflection.insights[0] || 'No specific insight'}\n`;
                });
                context += '\n';
            }
            
            if (feedback.length > 0) {
                context += `### Feedback to Incorporate\n`;
                feedback.forEach(f => {
                    context += `- ${f.feedback_type.charAt(0).toUpperCase() + f.feedback_type.slice(1)}: ${f.content}\n`;
                });
                context += '\n';
            }
            
            return context;
        } catch (error) {
            traceError('Failed to get agent learning context:', error);
            return '';
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