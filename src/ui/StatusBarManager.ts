import * as vscode from 'vscode';
import { Mood, MusicStatus } from '../types';

/**
 * StatusBarManager - Provides status bar integration for AgenticSuno.
 * Shows playback state, mood, and quick controls.
 */
export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: MusicStatus = 'idle';
    private currentMood: Mood = 'ambient';
    private isMuted: boolean = false;

    private readonly moodIcons: Record<Mood, string> = {
        epic: '🎸',
        tense: '🎻',
        triumphant: '🎺',
        focused: '🎹',
        ambient: '🎵',
    };

    private readonly statusIcons: Record<MusicStatus, string> = {
        idle: '💤',
        generating: '⏳',
        playing: '▶️',
        paused: '⏸️',
        error: '❌',
    };

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'agenticSuno.togglePlayPause';
        this.update();
        this.statusBarItem.show();
        console.log('StatusBarManager: Initialized');
    }

    /**
     * Update the status bar display
     */
    update(options?: {
        status?: MusicStatus;
        mood?: Mood;
        muted?: boolean;
        trackTitle?: string;
        agentCount?: number;
    }): void {
        if (options?.status !== undefined) this.currentStatus = options.status;
        if (options?.mood !== undefined) this.currentMood = options.mood;
        if (options?.muted !== undefined) this.isMuted = options.muted;

        // Build text
        let icon = this.statusIcons[this.currentStatus];
        if (this.isMuted) {
            icon = '🔇';
        }

        const moodIcon = this.moodIcons[this.currentMood];

        // Format: 🎵 ▶️ FOCUSED
        this.statusBarItem.text = `${moodIcon} ${icon} AgenticSuno`;

        // Build tooltip
        const tooltipLines = [
            `**AgenticSuno**`,
            `Status: ${this.currentStatus}`,
            `Mood: ${this.currentMood}`,
            ``,
            `Click to toggle play/pause`,
        ];

        if (options?.trackTitle) {
            tooltipLines.splice(3, 0, `Now Playing: ${options.trackTitle}`);
        }

        if (options?.agentCount && options.agentCount > 0) {
            tooltipLines.splice(3, 0, `Active Agents: ${options.agentCount}`);
        }

        this.statusBarItem.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

        // Color based on mood
        switch (this.currentMood) {
            case 'epic':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'tense':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'triumphant':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                break;
            default:
                this.statusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Set generating state (show spinner-like animation)
     */
    setGenerating(): void {
        this.update({ status: 'generating' });
    }

    /**
     * Set playing state
     */
    setPlaying(mood: Mood): void {
        this.update({ status: 'playing', mood });
    }

    /**
     * Set paused state
     */
    setPaused(): void {
        this.update({ status: 'paused' });
    }

    /**
     * Set idle state
     */
    setIdle(): void {
        this.update({ status: 'idle', mood: 'ambient' });
    }

    /**
     * Toggle mute indicator
     */
    setMuted(muted: boolean): void {
        this.update({ muted });
    }

    /**
     * Show error briefly
     */
    showError(message: string): void {
        this.update({ status: 'error' });
        setTimeout(() => {
            // Revert to previous state after 3 seconds
            this.update({ status: this.currentStatus === 'error' ? 'idle' : this.currentStatus });
        }, 3000);
    }

    show(): void {
        this.statusBarItem.show();
    }

    hide(): void {
        this.statusBarItem.hide();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
