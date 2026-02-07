import * as vscode from 'vscode';
import { SunoClient, MusicTrack } from '../suno/SunoClient';
import { AgentState, Mood, AgentActivity, MusicState, AudioClip } from '../types';
import { PlayerViewProvider } from '../ui/PlayerViewProvider';
import { MoodClassifier } from '../classification/MoodClassifier';

/**
 * MusicManager - Enhanced orchestrator for music generation and playback.
 * Coordinates between activity detection, mood classification, and audio playback.
 */
export class MusicManager {
    private client: SunoClient;
    private classifier: MoodClassifier;
    private queue: MusicTrack[] = [];
    private currentTrack: MusicTrack | undefined;
    private state: AgentState = { source: 'antigravity', status: 'idle', intensity: 1 };
    private isPlaying: boolean = false;
    private currentMood: Mood = 'ambient';
    private currentIntensity: number = 30;
    private extensionTimer: NodeJS.Timeout | undefined;

    // Track remaining time for extension scheduling
    private remainingTime: number = 0;
    private readonly EXTENSION_THRESHOLD = 15; // seconds

    constructor(private playerProvider: PlayerViewProvider) {
        this.client = new SunoClient();
        this.classifier = new MoodClassifier();
        console.log('MusicManager: Initialized');
    }

    /**
     * Handle incoming agent activity
     */
    public handleActivity(activity: AgentActivity): void {
        console.log(`MusicManager: Activity received - ${activity.classification.mood} (${activity.classification.intensity})`);

        // Update current mood and intensity
        const prevMood = this.currentMood;
        this.currentMood = activity.classification.mood;
        this.currentIntensity = activity.classification.intensity;

        // Update player UI
        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
        });

        // Add to activity feed
        this.playerProvider.addActivity(activity);

        // Check for significant mood transition
        if (this.classifier.detectMoodTransition(prevMood, this.currentMood)) {
            console.log(`MusicManager: Significant mood transition ${prevMood} -> ${this.currentMood}`);
            // Could trigger immediate transition here
        }

        // Convert to legacy state and handle
        const legacyState: AgentState = {
            source: activity.agentType,
            status: activity.classification.mood === 'ambient' ? 'idle' :
                activity.classification.mood === 'tense' ? 'error' :
                    activity.classification.mood === 'triumphant' ? 'success' : 'working',
            intensity: Math.round(activity.classification.intensity / 10),
            currentTask: activity.rawText.substring(0, 100),
            mood: activity.classification.mood,
        };

        this.handleStateChange(legacyState);
    }

    /**
     * Handle legacy state changes (backward compatibility)
     */
    public async handleStateChange(newState: AgentState) {
        if (this.shouldUpdateMusic(newState)) {
            console.log(`MusicManager: State changed to ${newState.status} (${newState.intensity})`);
            this.state = newState;

            // Update mood if provided
            if (newState.mood) {
                this.currentMood = newState.mood;
            }

            // If we are idle, maybe pause or switch to ambient
            if (newState.status === 'idle' && !this.isPlaying) {
                return; // Stay idle
            }

            // If we are working and no music, start
            if (newState.status === 'working' && !this.currentTrack) {
                await this.startFlow();
            }
        }
    }

    private shouldUpdateMusic(newState: AgentState): boolean {
        return newState.status !== this.state.status || newState.intensity !== this.state.intensity;
    }

    public async startFlow() {
        if (this.isPlaying) return;
        this.isPlaying = true;

        try {
            const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
            console.log(`MusicManager: Generating music - mood=${this.currentMood}, intensity=${this.currentIntensity}`);
            vscode.window.showInformationMessage(`AgenticSuno: Generating ${this.currentMood} music...`);

            const tracks = await this.client.generate(prompt);

            if (tracks && tracks.length > 0) {
                this.queue.push(...tracks);
                this.playNext();
                this.startExtensionScheduler();
            }
        } catch (error) {
            console.error('MusicManager: Generation error:', error);
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate music.');
            this.isPlaying = false;
        }
    }

    public stop() {
        this.isPlaying = false;
        this.queue = [];
        this.currentTrack = undefined;
        this.stopExtensionScheduler();
        this.playerProvider.stop();
    }

    public pause() {
        this.playerProvider.pause();
    }

    public resume() {
        this.playerProvider.resume();
    }

    public async skip() {
        if (this.queue.length > 0) {
            this.playNext();
        } else {
            // Generate new track
            await this.extendFlow();
        }
    }

    public updateTimeRemaining(currentTime: number, duration: number, remaining: number) {
        this.remainingTime = remaining;
    }

    private async playNext() {
        if (this.queue.length === 0) return;

        this.currentTrack = this.queue.shift();
        if (this.currentTrack) {
            console.log(`MusicManager: Playing track ${this.currentTrack.title || this.currentTrack.id}`);
            this.playerProvider.playTrack(
                this.currentTrack.audio_url,
                this.currentTrack.title || 'Generated Track',
                this.currentTrack.metadata?.tags || this.getPromptForMood(this.currentMood, this.currentIntensity),
                this.currentMood
            );
        }

        // Prefetch next track if queue is getting low
        if (this.queue.length < 2) {
            this.extendFlow();
        }
    }

    private startExtensionScheduler() {
        // Check every 5 seconds if we need to extend
        this.extensionTimer = setInterval(() => {
            if (this.remainingTime > 0 && this.remainingTime < this.EXTENSION_THRESHOLD) {
                if (this.queue.length === 0) {
                    console.log('MusicManager: Extension threshold reached, generating more...');
                    this.extendFlow();
                }
            }
        }, 5000);
    }

    private stopExtensionScheduler() {
        if (this.extensionTimer) {
            clearInterval(this.extensionTimer);
            this.extensionTimer = undefined;
        }
    }

    private async extendFlow() {
        if (!this.currentTrack) return;

        try {
            // Use mood-appropriate prompt for extension
            const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
            console.log(`MusicManager: Extending flow with mood=${this.currentMood}`);

            const tracks = await this.client.extend(this.currentTrack.id, prompt);
            if (tracks && tracks.length > 0) {
                this.queue.push(...tracks);
            }
        } catch (error) {
            console.error('MusicManager: Extension error:', error);
            // Fall back to generating new track
            try {
                const tracks = await this.client.generate(this.getPromptForMood(this.currentMood, this.currentIntensity));
                if (tracks && tracks.length > 0) {
                    this.queue.push(...tracks);
                }
            } catch (e) {
                console.error('MusicManager: Fallback generation also failed:', e);
            }
        }
    }

    /**
     * Generate prompt based on mood and intensity
     */
    private getPromptForMood(mood: Mood, intensity: number): string {
        const config = vscode.workspace.getConfiguration('agenticSuno');

        // Base prompts by mood
        const moodPrompts: Record<Mood, string> = {
            epic: 'epic orchestral, cinematic, powerful, heroic, dramatic',
            tense: 'dark ambient, tension, suspense, ominous, brooding',
            triumphant: 'uplifting, victorious, celebratory, major key, triumphant',
            focused: config.get('styles.working') || 'lo-fi beats, focus, concentration, chill',
            ambient: 'ambient, calm, minimal, atmospheric, peaceful',
        };

        let prompt = moodPrompts[mood];

        // Adjust for intensity
        if (intensity > 70) {
            prompt += ', fast tempo, intense, energetic';
        } else if (intensity > 50) {
            prompt += ', medium tempo, steady';
        } else if (intensity < 30) {
            prompt += ', slow tempo, gentle, soft';
        }

        // Add instrumental flag
        prompt += ', instrumental';

        return prompt;
    }

    /**
     * Legacy method for getting prompt based on AgentState
     */
    private getPromptForState(state: AgentState): string {
        const mood = state.mood || 'focused';
        const intensity = (state.intensity || 5) * 10;
        return this.getPromptForMood(mood, intensity);
    }

    public getCurrentMood(): Mood {
        return this.currentMood;
    }

    public isCurrentlyPlaying(): boolean {
        return this.isPlaying;
    }
}
