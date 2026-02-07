import * as vscode from 'vscode';
import { AgentActivity, AgentType, Mood, ActivityClassification } from '../types';

/**
 * Monitors VS Code output channels for AI agent activity patterns.
 * Detects Antigravity, Gemini, Cursor, Copilot, and Claude activity.
 */
export class OutputChannelMonitor {
    private _onActivity = new vscode.EventEmitter<AgentActivity>();
    readonly onActivity = this._onActivity.event;

    private _onAgentStart = new vscode.EventEmitter<{ agentType: AgentType }>();
    readonly onAgentStart = this._onAgentStart.event;

    private disposables: vscode.Disposable[] = [];
    private activeAgents = new Set<AgentType>();
    private lastActivityTime = new Map<AgentType, number>();
    private activityBuffer: string[] = [];
    private debounceTimer: NodeJS.Timeout | undefined;

    // Patterns to identify different AI agents
    private readonly agentPatterns: Map<AgentType, RegExp[]> = new Map([
        ['antigravity', [
            /task_boundary/i,
            /TaskName|TaskStatus|TaskSummary/i,
            /PLANNING|EXECUTION|VERIFICATION/i,
            /implementation_plan/i,
        ]],
        ['gemini', [
            /gemini/i,
            /google ai/i,
            /\[Gemini\]/i,
        ]],
        ['cursor', [
            /\[Cursor\]/i,
            /cursor ai/i,
            /composer/i,
        ]],
        ['claude', [
            /\[Claude\]/i,
            /anthropic/i,
            /claude code/i,
        ]],
        ['copilot', [
            /\[Copilot\]/i,
            /github copilot/i,
        ]],
    ]);

    // Keywords for mood detection
    private readonly moodKeywords = {
        epic: ['major', 'large', 'implement', 'create', 'build', 'architecture', 'refactor', 'redesign'],
        tense: ['error', 'failed', 'exception', 'retry', 'bug', 'fix', 'debug', 'issue', 'problem'],
        triumphant: ['success', 'complete', 'passed', 'verified', 'done', 'finished', 'resolved'],
        focused: ['working', 'processing', 'analyzing', 'reading', 'writing'],
        ambient: ['idle', 'waiting', 'paused'],
    };

    private readonly phaseKeywords = {
        planning: ['planning', 'design', 'analyzing', 'researching', 'investigating'],
        execution: ['implementing', 'writing', 'creating', 'building', 'coding'],
        verification: ['testing', 'verifying', 'checking', 'validating', 'reviewing'],
    };

    constructor() {
        console.log('OutputChannelMonitor: Initialized');
    }

    start(): void {
        console.log('OutputChannelMonitor: Starting...');

        // Monitor output channel changes via document changes
        // Note: VS Code doesn't have direct output channel events, so we use polling/document changes
        const outputWatcher = vscode.workspace.onDidChangeTextDocument((e) => {
            // Check if this is an output channel (they have a special scheme)
            if (e.document.uri.scheme === 'output') {
                this.handleOutputChange(e.document.getText());
            }
        });

        this.disposables.push(outputWatcher);

        // Also register a periodic check for active agents
        const intervalId = setInterval(() => this.checkAgentTimeout(), 5000);
        this.disposables.push({ dispose: () => clearInterval(intervalId) });
    }

    stop(): void {
        console.log('OutputChannelMonitor: Stopping...');
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }

    getActiveAgents(): AgentType[] {
        return Array.from(this.activeAgents);
    }

    private handleOutputChange(text: string): void {
        // Debounce to avoid processing too frequently
        this.activityBuffer.push(text);

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.processBuffer();
        }, 500); // 500ms debounce per REQ-2.2.1
    }

    private processBuffer(): void {
        const combinedText = this.activityBuffer.join('\n');
        this.activityBuffer = [];

        // Detect which agent is active
        const agentType = this.detectAgentType(combinedText);

        if (agentType !== 'unknown') {
            const wasActive = this.activeAgents.has(agentType);
            this.activeAgents.add(agentType);
            this.lastActivityTime.set(agentType, Date.now());

            if (!wasActive) {
                console.log(`OutputChannelMonitor: New agent detected - ${agentType}`);
                this._onAgentStart.fire({ agentType });
            }

            // Classify the activity
            const classification = this.classifyActivity(combinedText);

            const activity: AgentActivity = {
                id: `output-${Date.now()}`,
                agentType,
                source: 'output_channel',
                timestamp: Date.now(),
                rawText: combinedText.substring(0, 500), // Truncate for memory
                classification,
            };

            this._onActivity.fire(activity);
        }
    }

    private detectAgentType(text: string): AgentType {
        for (const [agent, patterns] of this.agentPatterns) {
            for (const pattern of patterns) {
                if (pattern.test(text)) {
                    return agent;
                }
            }
        }
        return 'unknown';
    }

    private classifyActivity(text: string): ActivityClassification {
        const lowerText = text.toLowerCase();
        const signals: string[] = [];

        // Detect mood
        let mood: Mood = 'focused';
        let maxMoodScore = 0;

        for (const [moodType, keywords] of Object.entries(this.moodKeywords)) {
            let score = 0;
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    score++;
                    signals.push(keyword);
                }
            }
            if (score > maxMoodScore) {
                maxMoodScore = score;
                mood = moodType as Mood;
            }
        }

        // Detect phase
        let taskPhase: 'planning' | 'execution' | 'verification' | 'idle' = 'execution';
        for (const [phase, keywords] of Object.entries(this.phaseKeywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    taskPhase = phase as typeof taskPhase;
                    break;
                }
            }
        }

        // Calculate intensity (0-100)
        let intensity = 50; // Default middle intensity

        // Increase intensity for error/tense signals
        if (mood === 'tense') {
            intensity = 70 + Math.min(signals.length * 5, 30);
        }
        // Epic tasks get high intensity
        if (mood === 'epic') {
            intensity = 60 + Math.min(signals.length * 10, 40);
        }
        // Success/triumph is moderate-high
        if (mood === 'triumphant') {
            intensity = 65;
        }
        // Ambient is low
        if (mood === 'ambient') {
            intensity = 20;
        }

        return { mood, intensity, taskPhase, signals };
    }

    private checkAgentTimeout(): void {
        const now = Date.now();
        const timeout = 30000; // 30 seconds of inactivity = agent done

        for (const [agent, lastTime] of this.lastActivityTime) {
            if (now - lastTime > timeout && this.activeAgents.has(agent)) {
                console.log(`OutputChannelMonitor: Agent ${agent} timed out`);
                this.activeAgents.delete(agent);
            }
        }
    }

    dispose(): void {
        this.stop();
        this._onActivity.dispose();
        this._onAgentStart.dispose();
    }
}
