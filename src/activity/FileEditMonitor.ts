import * as vscode from 'vscode';
import { AgentActivity, AgentType, Mood } from '../types';

/**
 * Monitors file edits to detect AI agent activity (especially Cursor Composer).
 * 
 * Detection heuristics:
 * - Rapid automated edits (multiple changes in quick succession without typing)
 * - Large batch edits (many lines changed at once)
 * - Changes to multiple files in rapid succession
 * 
 * This is the PRIMARY way to detect Cursor Composer activity since it
 * doesn't write to output channels or use terminal commands.
 */
export class FileEditMonitor {
    private _onActivity = new vscode.EventEmitter<AgentActivity>();
    readonly onActivity = this._onActivity.event;

    private _onAgentStart = new vscode.EventEmitter<{ agentType: AgentType }>();
    readonly onAgentStart = this._onAgentStart.event;

    private _onAgentEnd = new vscode.EventEmitter<{ agentType: AgentType; duration: number }>();
    readonly onAgentEnd = this._onAgentEnd.event;

    private disposables: vscode.Disposable[] = [];

    // Track edit patterns
    private recentEdits: { timestamp: number; uri: string; changeCount: number }[] = [];
    private lastUserTypingTime = 0;
    private isUserTyping = false;
    private typingTimeout: NodeJS.Timeout | undefined;

    // Agent session tracking
    private agentSessionStart: number | undefined;
    private sessionTimeout: NodeJS.Timeout | undefined;
    private activeAgentType: AgentType = 'unknown';

    // Thresholds for detection
    private readonly RAPID_EDIT_WINDOW_MS = 2000;  // Time window to consider edits as "rapid"
    private readonly RAPID_EDIT_THRESHOLD = 3;     // Number of edits in window to trigger detection
    private readonly BATCH_EDIT_THRESHOLD = 10;    // Lines changed to consider as automated
    private readonly SESSION_TIMEOUT_MS = 5000;    // Inactivity before session ends

    constructor() {
        console.log('FileEditMonitor: Initialized');
    }

    start(): void {
        console.log('FileEditMonitor: Starting...');

        // Monitor text document changes
        const docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
            this.handleDocumentChange(e);
        });
        this.disposables.push(docChangeListener);

        // Detect user typing (keyboard input)
        const selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
            // Selection changes during typing
            this.markUserTyping();
        });
        this.disposables.push(selectionListener);

        // Also detect window focus changes - useful for knowing when user is active
        const focusListener = vscode.window.onDidChangeWindowState((e) => {
            if (e.focused) {
                this.markUserTyping();
            }
        });
        this.disposables.push(focusListener);
    }

    stop(): void {
        console.log('FileEditMonitor: Stopping...');
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
    }

    private markUserTyping(): void {
        this.lastUserTypingTime = Date.now();
        this.isUserTyping = true;

        // Clear typing flag after 500ms of no selection changes
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isUserTyping = false;
        }, 500);
    }

    private handleDocumentChange(e: vscode.TextDocumentChangeEvent): void {
        // Ignore output channels and other non-file documents
        if (e.document.uri.scheme !== 'file') return;

        // Ignore empty changes
        if (e.contentChanges.length === 0) return;

        const now = Date.now();
        const totalLinesChanged = e.contentChanges.reduce((sum, change) => {
            return sum + Math.max(
                change.range.end.line - change.range.start.line + 1,
                change.text.split('\n').length
            );
        }, 0);

        // Record this edit
        this.recentEdits.push({
            timestamp: now,
            uri: e.document.uri.toString(),
            changeCount: totalLinesChanged,
        });

        // Clean old edits outside the window
        this.recentEdits = this.recentEdits.filter(
            edit => now - edit.timestamp < this.RAPID_EDIT_WINDOW_MS
        );

        // Check for AI agent indicators
        const isLikelyAI = this.detectAIActivity(totalLinesChanged);

        if (isLikelyAI) {
            this.handleDetectedActivity(e.document.uri, totalLinesChanged);
        }
    }

    private detectAIActivity(linesChanged: number): boolean {
        const now = Date.now();

        // If user was typing recently (within 1s), less likely to be AI
        const timeSinceTyping = now - this.lastUserTypingTime;
        if (timeSinceTyping < 1000 && this.isUserTyping) {
            return false;
        }

        // Indicator 1: Batch edit (many lines at once)
        if (linesChanged >= this.BATCH_EDIT_THRESHOLD) {
            console.log(`FileEditMonitor: Batch edit detected (${linesChanged} lines)`);
            return true;
        }

        // Indicator 2: Rapid succession of edits
        if (this.recentEdits.length >= this.RAPID_EDIT_THRESHOLD) {
            // Check if edits are to multiple files (strong indicator)
            const uniqueFiles = new Set(this.recentEdits.map(e => e.uri));
            if (uniqueFiles.size >= 2) {
                console.log(`FileEditMonitor: Rapid multi-file edits detected (${uniqueFiles.size} files)`);
                return true;
            }

            // Even single file rapid edits can be AI
            console.log(`FileEditMonitor: Rapid edits detected (${this.recentEdits.length} edits)`);
            return true;
        }

        return false;
    }

    private handleDetectedActivity(uri: vscode.Uri, linesChanged: number): void {
        const now = Date.now();

        // Determine agent type - for now, assume Cursor since that's our primary target
        // In the future, we could try to detect based on file patterns or other heuristics
        let agentType: AgentType = 'cursor';

        // Check for known agent file patterns
        const path = uri.fsPath.toLowerCase();
        if (path.includes('.gemini') || path.includes('.agent')) {
            agentType = 'antigravity';
        } else if (path.includes('.claude')) {
            agentType = 'claude';
        }

        // Start new session if needed
        if (!this.agentSessionStart) {
            this.agentSessionStart = now;
            this.activeAgentType = agentType;
            console.log(`FileEditMonitor: Agent session started - ${agentType}`);
            this._onAgentStart.fire({ agentType });
        }

        // Reset session timeout
        if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
        this.sessionTimeout = setTimeout(() => {
            this.endSession();
        }, this.SESSION_TIMEOUT_MS);

        // Calculate mood based on activity
        let mood: Mood = 'focused';
        let intensity = 50;

        if (linesChanged >= 50) {
            mood = 'epic';
            intensity = 80;
        } else if (linesChanged >= 20) {
            mood = 'focused';
            intensity = 65;
        } else if (this.recentEdits.length >= 5) {
            mood = 'focused';
            intensity = 55;
        }

        // Emit activity
        const activity: AgentActivity = {
            id: `file-edit-${now}`,
            agentType,
            source: 'file_system',
            timestamp: now,
            rawText: `File edited: ${uri.fsPath.split('/').pop()} (${linesChanged} lines)`,
            classification: {
                mood,
                intensity,
                taskPhase: 'execution',
                signals: ['file-edit', 'automated', agentType],
            },
        };

        this._onActivity.fire(activity);
    }

    private endSession(): void {
        if (this.agentSessionStart) {
            const duration = Date.now() - this.agentSessionStart;
            console.log(`FileEditMonitor: Agent session ended - ${this.activeAgentType} (${duration}ms)`);
            this._onAgentEnd.fire({ agentType: this.activeAgentType, duration });
            this.agentSessionStart = undefined;
            this.activeAgentType = 'unknown';
        }
    }

    dispose(): void {
        this.stop();
        this._onActivity.dispose();
        this._onAgentStart.dispose();
        this._onAgentEnd.dispose();
    }
}
