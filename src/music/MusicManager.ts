import * as vscode from 'vscode';
import { SunoClient, MusicTrack, GenerateResult, GenerationMetrics } from '../suno/SunoClient';
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

    // Track generation timing
    private generationStartTime: number = 0;
    private generationIntervalId: NodeJS.Timeout | undefined;

    // Debounce extend-on-activity to avoid too many concurrent extensions
    private lastExtendOnActivityTime: number = 0;
    private readonly EXTEND_ON_ACTIVITY_DEBOUNCE_MS = 12000;

    // Background music cache
    private moodCache: Map<Mood, MusicTrack[]> = new Map();
    private pendingGenerations: Map<Mood, Promise<void>> = new Map();

    constructor(private playerProvider: PlayerViewProvider) {
        this.client = new SunoClient();
        this.classifier = new MoodClassifier();
        console.log('MusicManager: Initialized');

        // Start background caching for common moods
        this.initializeCache();
    }

    private async initializeCache() {
        // Give extension a moment to start up before hitting API
        setTimeout(() => {
            console.log('MusicManager: Initializing background cache...');
            // Cache most likely moods first
            this.generateInBackground('focused');
            this.generateInBackground('ambient');
        }, 3000);
    }

    private async generateInBackground(mood: Mood) {
        if (this.pendingGenerations.has(mood)) return;

        // Don't cache if we already have tracks
        const cached = this.moodCache.get(mood) || [];
        if (cached.length > 0) return;

        console.log(`MusicManager: Starting background generation for ${mood}`);

        const generationPromise = (async () => {
            try {
                const prompt = this.getPromptForMood(mood, 30); // Default intensity
                // Use silent mode to avoid UI spam
                const result = await this.client.generate(prompt, true, true);

                if (result.tracks && result.tracks.length > 0) {
                    const currentCache = this.moodCache.get(mood) || [];
                    currentCache.push(...result.tracks);
                    this.moodCache.set(mood, currentCache);
                    console.log(`MusicManager: Cached ${result.tracks.length} tracks for ${mood}`);
                }
            } catch (error) {
                console.error(`MusicManager: Failed to cache for ${mood}`, error);
            } finally {
                this.pendingGenerations.delete(mood);
            }
        })();

        this.pendingGenerations.set(mood, generationPromise);
        return generationPromise;
    }

    /**
     * Handle incoming agent activity.
     * Updates mood and, when already playing, extends the song in the new mood direction.
     */
    public handleActivity(activity: AgentActivity): void {
        console.log(`MusicManager: Activity received - ${activity.classification.mood} (${activity.classification.intensity})`);

        // Re-classify from raw text when we have meaningful content (e.g. output channel)
        const classification = activity.rawText.length > 20
            ? this.classifier.classify(activity.rawText)
            : activity.classification;

        const prevMood = this.currentMood;
        const prevIntensity = this.currentIntensity;
        this.currentMood = classification.mood;
        this.currentIntensity = classification.intensity;

        // Update player UI
        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
        });

        // Add to activity feed (use original activity with possibly richer classification)
        this.playerProvider.addActivity({
            ...activity,
            classification,
        });

        // If we're already playing and mood/intensity changed, extend the song in this direction (debounced)
        const moodOrIntensityChanged = prevMood !== this.currentMood || Math.abs(prevIntensity - this.currentIntensity) > 15;
        const now = Date.now();
        const debounceOk = now - this.lastExtendOnActivityTime >= this.EXTEND_ON_ACTIVITY_DEBOUNCE_MS;
        if (this.isPlaying && moodOrIntensityChanged && debounceOk) {
            this.lastExtendOnActivityTime = now;
            console.log(`MusicManager: Extending song toward ${this.currentMood} (${this.currentIntensity})`);
            this.extendFlow();
        }

        // Check for significant mood transition
        if (this.classifier.detectMoodTransition(prevMood, this.currentMood)) {
            console.log(`MusicManager: Significant mood transition ${prevMood} -> ${this.currentMood}`);
        }

        // Convert to legacy state and handle
        const legacyState: AgentState = {
            source: activity.agentType,
            status: classification.mood === 'ambient' ? 'idle' :
                classification.mood === 'tense' ? 'error' :
                    classification.mood === 'triumphant' ? 'success' : 'working',
            intensity: Math.round(classification.intensity / 10),
            currentTask: activity.rawText.substring(0, 100),
            mood: classification.mood,
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

    /**
     * Start music as soon as the user sends a message (first activity).
     * Uses the activity content to set mood and optional prompt hints.
     */
    public async startFlowFromActivity(activity: AgentActivity): Promise<void> {
        if (this.isPlaying) return;

        // Classify from chat/activity content for content-driven mood
        const classification = activity.rawText.length > 10
            ? this.classifier.classify(activity.rawText)
            : activity.classification;
        this.currentMood = classification.mood;
        this.currentIntensity = classification.intensity;

        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
        });
        this.playerProvider.addActivity({ ...activity, classification });

        console.log(`MusicManager: Starting from activity - mood=${this.currentMood}, intensity=${this.currentIntensity}`);
        await this.startFlow(activity.rawText);
    }

    public async startFlow(customPromptHint?: string) {
        if (this.isPlaying) return;
        this.isPlaying = true;

        try {
            const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
            console.log(`MusicManager: Generating music - mood=${this.currentMood}, intensity=${this.currentIntensity}`);

            // Check cache first!
            let cachedTracks = this.moodCache.get(this.currentMood);

            // If cache is empty but we have a pending generation, wait for it!
            if ((!cachedTracks || cachedTracks.length === 0) && this.pendingGenerations.has(this.currentMood)) {
                console.log(`MusicManager: Waiting for background generation to complete for ${this.currentMood}...`);
                vscode.window.setStatusBarMessage(`AgenticSuno: Waiting for background generation...`, 3000);

                try {
                    await this.pendingGenerations.get(this.currentMood);
                    // Refresh cache check
                    cachedTracks = this.moodCache.get(this.currentMood);
                } catch (e) {
                    console.error('MusicManager: Error waiting for background generation', e);
                }
            }

            if (cachedTracks && cachedTracks.length > 0) {
                console.log(`MusicManager: Cache HIT for ${this.currentMood}`);
                const track = cachedTracks.shift();
                this.moodCache.set(this.currentMood, cachedTracks); // Update cache

                if (track) {
                    this.queue.push(track);
                    this.playNext();
                    this.startExtensionScheduler();

                    // Replenish cache in background
                    this.generateInBackground(this.currentMood);
                    return;
                }
            }

            console.log(`MusicManager: Cache MISS for ${this.currentMood}, generating live`);
            vscode.window.showInformationMessage(`AgenticSuno: Generating ${this.currentMood} music...`);

            // Start the generation timer UI
            this.startGenerationTimer();

            const finalPrompt = this.blendContentHint(prompt, customPromptHint);
            const result = await this.client.generate(finalPrompt);

            // Stop timer and show results
            this.stopGenerationTimer();
            this.showGenerationMetrics(result.metrics);

            if (result.tracks && result.tracks.length > 0) {
                this.queue.push(...result.tracks);
                this.playNext();
                this.startExtensionScheduler();
            }
        } catch (error) {
            console.error('MusicManager: Generation error:', error);
            this.stopGenerationTimer();
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

            // Start timer for extension
            this.startGenerationTimer();

            const result = await this.client.extend(this.currentTrack.id, prompt);

            this.stopGenerationTimer();
            this.showGenerationMetrics(result.metrics);

            if (result.tracks && result.tracks.length > 0) {
                this.queue.push(...result.tracks);
            }
        } catch (error) {
            console.error('MusicManager: Extension error:', error);
            this.stopGenerationTimer();
            // Fall back to generating new track
            try {
                const result = await this.client.generate(this.getPromptForMood(this.currentMood, this.currentIntensity));
                if (result.tracks && result.tracks.length > 0) {
                    this.queue.push(...result.tracks);
                }
            } catch (e) {
                console.error('MusicManager: Fallback generation also failed:', e);
            }
        }
    }

    /**
     * Start the generation timer in the UI
     */
    private startGenerationTimer() {
        this.generationStartTime = Date.now();
        this.playerProvider.showGenerating(0);

        // Update timer every second
        this.generationIntervalId = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.generationStartTime) / 1000);
            this.playerProvider.showGenerating(elapsedSeconds);
        }, 1000);
    }

    /**
     * Stop the generation timer
     */
    private stopGenerationTimer() {
        if (this.generationIntervalId) {
            clearInterval(this.generationIntervalId);
            this.generationIntervalId = undefined;
        }
    }

    /**
     * Display generation metrics to user
     */
    private showGenerationMetrics(metrics: GenerationMetrics) {
        const seconds = (metrics.elapsedMs / 1000).toFixed(1);
        console.log(`MusicManager: Generation took ${seconds}s (${metrics.pollAttempts} poll attempts)`);
        vscode.window.showInformationMessage(`AgenticSuno: Music ready in ${seconds}s`);
        this.playerProvider.showGenerationComplete(parseFloat(seconds));
    }

    /**
     * Blend optional content hint (e.g. from chat) into the mood prompt for more relevant music.
     */
    private blendContentHint(basePrompt: string, contentHint?: string): string {
        if (!contentHint || contentHint.length < 5) return basePrompt;
        // Take a short, sanitized slice to avoid API limits and noise
        const sanitized = contentHint.replace(/\s+/g, ' ').trim().substring(0, 80);
        if (sanitized.length < 5) return basePrompt;
        return `${basePrompt}, inspired by: ${sanitized}`;
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
