import * as vscode from 'vscode';
import { AgentActivity, AgentType, Mood, ActivityClassification, AgentState } from '../types';
import { OutputChannelMonitor } from './OutputChannelMonitor';
import { TerminalMonitor } from './TerminalMonitor';
import { FileEditMonitor } from './FileEditMonitor';

/**
 * Unified Activity Monitor - Facade combining all activity sources.
 * Provides a single interface for the MusicOrchestrator to consume agent activity.
 */
export class ActivityMonitor {
    private _onActivity = new vscode.EventEmitter<AgentActivity>();
    readonly onActivity = this._onActivity.event;

    private _onAgentStart = new vscode.EventEmitter<{ agentType: AgentType }>();
    readonly onAgentStart = this._onAgentStart.event;

    private _onAgentEnd = new vscode.EventEmitter<{ agentType: AgentType; duration: number }>();
    readonly onAgentEnd = this._onAgentEnd.event;

    // Also emit legacy AgentState for backward compatibility
    private _onStateChange = new vscode.EventEmitter<AgentState>();
    readonly onStateChange = this._onStateChange.event;

    private outputMonitor: OutputChannelMonitor;
    private terminalMonitor: TerminalMonitor;
    private fileEditMonitor: FileEditMonitor;
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    private disposables: vscode.Disposable[] = [];
    private recentActivities: AgentActivity[] = [];
    private readonly maxRecentActivities = 50;

    // Track active agents with their start times
    private activeAgentSessions = new Map<AgentType, { startTime: number; lastActivity: AgentActivity }>();
    private agentTimeouts = new Map<AgentType, NodeJS.Timeout>();

    constructor(private workspaceRoot?: string) {
        this.outputMonitor = new OutputChannelMonitor();
        this.terminalMonitor = new TerminalMonitor();
        this.fileEditMonitor = new FileEditMonitor();
        console.log('ActivityMonitor: Initialized');
    }

    start(): void {
        console.log('ActivityMonitor: Starting all monitors...');

        // Start sub-monitors
        this.outputMonitor.start();
        this.terminalMonitor.start();
        this.fileEditMonitor.start();

        // Wire up output channel events
        this.disposables.push(
            this.outputMonitor.onActivity((activity) => this.handleActivity(activity))
        );
        this.disposables.push(
            this.outputMonitor.onAgentStart((e) => this._onAgentStart.fire(e))
        );

        // Wire up terminal events
        this.disposables.push(
            this.terminalMonitor.onActivity((activity) => this.handleActivity(activity))
        );

        // Wire up file edit monitor (PRIMARY way to detect Cursor Composer)
        this.disposables.push(
            this.fileEditMonitor.onActivity((activity) => this.handleActivity(activity))
        );
        this.disposables.push(
            this.fileEditMonitor.onAgentStart((e) => {
                console.log(`ActivityMonitor: FileEditMonitor detected agent start - ${e.agentType}`);
                this._onAgentStart.fire(e);
            })
        );

        // Setup file system watcher for agent artifacts
        if (this.workspaceRoot) {
            this.setupFileWatcher();
        }
    }

    stop(): void {
        console.log('ActivityMonitor: Stopping all monitors...');
        this.outputMonitor.stop();
        this.terminalMonitor.stop();
        this.fileEditMonitor.stop();
        this.fileWatcher?.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];

        // Clear all timeouts
        for (const timeout of this.agentTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.agentTimeouts.clear();
    }

    getActiveAgents(): AgentType[] {
        return Array.from(this.activeAgentSessions.keys());
    }

    getActiveAgentCount(): number {
        return this.activeAgentSessions.size;
    }

    getRecentActivities(): AgentActivity[] {
        return [...this.recentActivities];
    }

    /**
     * Calculate current overall mood based on recent activities
     */
    getCurrentMood(): { mood: Mood; intensity: number } {
        if (this.recentActivities.length === 0) {
            return { mood: 'ambient', intensity: 10 };
        }

        // Use most recent 10 activities weighted by recency
        const recent = this.recentActivities.slice(-10);
        const moodCounts = new Map<Mood, number>();
        let totalIntensity = 0;

        recent.forEach((activity, index) => {
            const weight = (index + 1) / recent.length; // More recent = higher weight
            const mood = activity.classification.mood;
            moodCounts.set(mood, (moodCounts.get(mood) || 0) + weight);
            totalIntensity += activity.classification.intensity * weight;
        });

        // Find dominant mood
        let dominantMood: Mood = 'focused';
        let maxCount = 0;
        for (const [mood, count] of moodCounts) {
            if (count > maxCount) {
                maxCount = count;
                dominantMood = mood;
            }
        }

        // Average intensity
        const avgIntensity = Math.round(totalIntensity / recent.length);

        return { mood: dominantMood, intensity: avgIntensity };
    }

    private handleActivity(activity: AgentActivity): void {
        console.log(`ActivityMonitor: Activity from ${activity.source} - ${activity.agentType} (${activity.classification.mood})`);

        // Store in recent activities
        this.recentActivities.push(activity);
        if (this.recentActivities.length > this.maxRecentActivities) {
            this.recentActivities.shift();
        }

        // Track agent session
        if (!this.activeAgentSessions.has(activity.agentType)) {
            this.activeAgentSessions.set(activity.agentType, {
                startTime: Date.now(),
                lastActivity: activity,
            });
            this._onAgentStart.fire({ agentType: activity.agentType });
        } else {
            const session = this.activeAgentSessions.get(activity.agentType)!;
            session.lastActivity = activity;
        }

        // Reset/set timeout for agent end detection
        this.resetAgentTimeout(activity.agentType);

        // Emit the activity
        this._onActivity.fire(activity);

        // Also emit legacy state for backward compatibility
        const legacyState = this.convertToLegacyState(activity);
        this._onStateChange.fire(legacyState);
    }

    private resetAgentTimeout(agentType: AgentType): void {
        // Clear existing timeout
        const existingTimeout = this.agentTimeouts.get(agentType);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Set new timeout - agent is considered "ended" after 60s of inactivity
        const timeout = setTimeout(() => {
            const session = this.activeAgentSessions.get(agentType);
            if (session) {
                const duration = Date.now() - session.startTime;
                console.log(`ActivityMonitor: Agent ${agentType} ended after ${duration}ms`);
                this.activeAgentSessions.delete(agentType);
                this.agentTimeouts.delete(agentType);
                this._onAgentEnd.fire({ agentType, duration });
            }
        }, 60000);

        this.agentTimeouts.set(agentType, timeout);
    }

    private setupFileWatcher(): void {
        if (!this.workspaceRoot) return;

        // Watch for agent artifact directories
        const patterns = [
            '**/.gemini/**',
            '**/.cursorrules',
            '**/.claude/**',
            '**/.agent/**',
        ];

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.workspaceRoot, pattern)
            );

            watcher.onDidChange((uri) => this.handleFileChange(uri, 'change'));
            watcher.onDidCreate((uri) => this.handleFileChange(uri, 'create'));

            this.disposables.push(watcher);
        }
    }

    private handleFileChange(uri: vscode.Uri, changeType: 'change' | 'create'): void {
        // Determine agent type from path
        const path = uri.fsPath.toLowerCase();
        let agentType: AgentType = 'unknown';

        if (path.includes('.gemini')) agentType = 'antigravity';
        else if (path.includes('.cursorrules') || path.includes('.cursor')) agentType = 'cursor';
        else if (path.includes('.claude')) agentType = 'claude';
        else if (path.includes('.agent')) agentType = 'antigravity';

        if (agentType === 'unknown') return;

        const activity: AgentActivity = {
            id: `file-${Date.now()}`,
            agentType,
            source: 'file_system',
            timestamp: Date.now(),
            rawText: `File ${changeType}: ${uri.fsPath}`,
            classification: {
                mood: 'focused',
                intensity: 40,
                taskPhase: 'execution',
                signals: [`file-${changeType}`, agentType],
            },
        };

        this.handleActivity(activity);
    }

    private convertToLegacyState(activity: AgentActivity): AgentState {
        // Convert mood to legacy status
        let status: 'idle' | 'working' | 'error' | 'success' = 'working';
        if (activity.classification.mood === 'ambient') status = 'idle';
        if (activity.classification.mood === 'tense') status = 'error';
        if (activity.classification.mood === 'triumphant') status = 'success';

        // Convert 0-100 intensity to 1-10
        const legacyIntensity = Math.max(1, Math.min(10, Math.round(activity.classification.intensity / 10)));

        return {
            source: activity.agentType,
            status,
            intensity: legacyIntensity,
            currentTask: activity.rawText.substring(0, 100),
            mood: activity.classification.mood,
        };
    }

    dispose(): void {
        this.stop();
        this._onActivity.dispose();
        this._onAgentStart.dispose();
        this._onAgentEnd.dispose();
        this._onStateChange.dispose();
    }
}
