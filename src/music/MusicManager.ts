import * as vscode from 'vscode';
import { MusicTrack, GenerateResult, GenerationMetrics } from '../suno/SunoClient';
import {
    AgentState,
    Mood,
    AgentActivity,
    PersistedTrack,
    StoredProjectTheme,
    MusicEngineMode,
    LyriaGenerationPreset,
    LyriaPromptWeight,
} from '../types';
import { PlayerViewProvider } from '../ui/PlayerViewProvider';
import { MoodClassifier } from '../classification/MoodClassifier';
import { LyriaGenerationConfig, LyriaWeightedPrompt } from '../lyria/types';
import { buildGenerationConfig, buildWeightedPrompts } from './LyriaSteering';
import { LyriaEngineAdapter, MusicGenerationEngine, SunoEngineAdapter } from './engine';

const WORKSPACE_STATE_KEY_LIBRARY = 'agenticSuno.library';
const WORKSPACE_STATE_KEY_PROJECT_THEME = 'agenticSuno.projectTheme';
const LIBRARY_MAX_TRACKS = 50;
const PROJECT_THEME_PROMPT_MAX_CHARS = 400;

type PlaybackOrigin = 'idle' | 'lyria_realtime' | 'suno_generated' | 'library_url';

interface ActivitySignal {
    timestamp: number;
    mood: Mood;
    intensity: number;
    hint: string;
}

interface AggregatedSignal {
    mood: Mood;
    intensity: number;
    hint?: string;
    activityDensity: number;
    moodDelta: number;
}

export class MusicManager {
    private readonly generationEngine: MusicGenerationEngine;
    private readonly classifier: MoodClassifier;
    private readonly lyriaEngine: LyriaEngineAdapter;

    private queue: MusicTrack[] = [];
    private currentTrack: MusicTrack | undefined;
    private state: AgentState = { source: 'antigravity', status: 'idle', intensity: 1 };
    private isPlaying = false;
    private isPaused = false;
    private currentMood: Mood = 'ambient';
    private currentIntensity = 30;

    // Legacy Suno extension scheduling
    private extensionTimer: NodeJS.Timeout | undefined;
    private remainingTime = 0;
    private readonly EXTENSION_THRESHOLD = 15; // seconds

    // Generation timer UI
    private generationStartTime = 0;
    private generationIntervalId: NodeJS.Timeout | undefined;

    // Debounce steering/extend-on-activity
    private lastSteerOrExtendTime = 0;
    private readonly STEER_DEBOUNCE_MS = 2500;
    private readonly EXTEND_ON_ACTIVITY_DEBOUNCE_MS = 12000;

    // Background cache for Suno fallback
    private moodCache: Map<Mood, MusicTrack[]> = new Map();
    private pendingGenerations: Map<Mood, Promise<void>> = new Map();

    // Persisted library and project theme (per-workspace)
    private library: PersistedTrack[] = [];
    private projectTheme: StoredProjectTheme | null = null;

    // Realtime session flags
    private realtimeActive = false;
    private playbackOrigin: PlaybackOrigin = 'idle';
    private activeAgentCount = 0;
    private lastActivityHint = '';
    private activitySignals: ActivitySignal[] = [];
    private aggregatedIntensity = 30;
    private aggregatedMood: Mood = 'ambient';
    private skipCounter = 0;
    private readonly SIGNAL_WINDOW_MS = 60000;
    private readonly SIGNAL_HALF_LIFE_MS = 18000;
    private readonly MAX_SIGNAL_WINDOW = 80;
    private readonly EWMA_ALPHA = 0.32;

    constructor(
        private readonly playerProvider: PlayerViewProvider,
        private readonly workspaceState: vscode.Memento
    ) {
        this.generationEngine = new SunoEngineAdapter();
        this.classifier = new MoodClassifier();

        this.lyriaEngine = new LyriaEngineAdapter(
            this.getGeminiApiKey(),
            this.getLyriaModel(),
            {
                onStreamInit: (session) => {
                    this.playerProvider.streamInit({ sessionId: session.sessionId });
                },
                onStreamChunk: (chunk) => {
                    this.playerProvider.streamChunk(chunk);
                },
                onStreamPause: () => {
                    this.playerProvider.streamPause();
                },
                onStreamResume: () => {
                    this.playerProvider.streamResume();
                },
                onStreamStop: () => {
                    this.playerProvider.streamStop();
                },
                onStreamReset: () => {
                    this.playerProvider.streamReset();
                },
                onWarning: (message) => {
                    console.warn('MusicManager[Lyria]:', message);
                },
                onError: (message) => {
                    console.error('MusicManager[Lyria] error:', message);
                    this.playerProvider.streamError(message);
                },
            }
        );

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('agenticSuno.geminiApiKey') ||
                event.affectsConfiguration('agenticSuno.lyriaModel')
            ) {
                this.lyriaEngine.configure(this.getGeminiApiKey(), this.getLyriaModel());
            }
        });

        console.log('MusicManager: Initialized with Suno fallback + Lyria realtime support');
        this.logRouting('startup');
        this.initializeCache();
    }

    private initializeCache(): void {
        if (!this.isSunoGenerationAllowed()) {
            console.log('MusicManager: Skipping fallback cache warmup because Lyria is preferred.');
            return;
        }

        setTimeout(() => {
            console.log('MusicManager: Initializing fallback cache...');
            void this.generateInBackground('focused');
            void this.generateInBackground('ambient');
        }, 3000);
    }

    private async generateInBackground(mood: Mood): Promise<void> {
        if (!this.isSunoGenerationAllowed() || this.playbackOrigin === 'lyria_realtime' || this.playbackOrigin === 'library_url') {
            return;
        }

        if (this.pendingGenerations.has(mood)) return;

        const cached = this.moodCache.get(mood) || [];
        if (cached.length > 0) return;

        const generationPromise = (async () => {
            try {
                const prompt = this.getPromptForMood(mood, 30);
                const result = await this.generationEngine.generate(prompt, true, true);

                if (result.tracks && result.tracks.length > 0) {
                    const currentCache = this.moodCache.get(mood) || [];
                    currentCache.push(...result.tracks);
                    this.moodCache.set(mood, currentCache);
                }
            } catch (error) {
                console.error(`MusicManager: Failed to cache ${mood} fallback tracks`, error);
            } finally {
                this.pendingGenerations.delete(mood);
            }
        })();

        this.pendingGenerations.set(mood, generationPromise);
        await generationPromise;
    }

    public handleActivity(activity: AgentActivity, agentCount?: number): void {
        const classification = activity.rawText.length > 20
            ? this.classifier.classify(activity.rawText)
            : activity.classification;

        const prevMood = this.aggregatedMood;
        const prevIntensity = this.aggregatedIntensity;
        if (typeof agentCount === 'number') {
            this.activeAgentCount = Math.max(0, Math.floor(agentCount));
        }
        this.lastActivityHint = activity.rawText;

        this.pushActivitySignal(activity, classification.mood, classification.intensity);
        const aggregated = this.aggregateSignal();

        this.aggregatedMood = aggregated.mood;
        this.aggregatedIntensity = aggregated.intensity;
        this.currentMood = aggregated.mood;
        this.currentIntensity = aggregated.intensity;

        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
            agentCount: this.activeAgentCount,
        });

        this.playerProvider.addActivity({
            ...activity,
            classification,
        });

        const moodOrIntensityChanged = prevMood !== this.currentMood || Math.abs(prevIntensity - this.currentIntensity) > 7;
        const now = Date.now();

        if (this.isPlaying && moodOrIntensityChanged) {
            if (this.realtimeActive) {
                const debounceOk = now - this.lastSteerOrExtendTime >= this.STEER_DEBOUNCE_MS;
                if (debounceOk) {
                    this.lastSteerOrExtendTime = now;
                    void this.steerRealtimeSession(aggregated.hint, aggregated);
                }
            } else {
                const debounceOk = now - this.lastSteerOrExtendTime >= this.EXTEND_ON_ACTIVITY_DEBOUNCE_MS;
                if (debounceOk && this.playbackOrigin !== 'library_url' && this.isSunoGenerationAllowed()) {
                    this.lastSteerOrExtendTime = now;
                    void this.extendFlow();
                }
            }
        }

        const legacyState: AgentState = {
            source: activity.agentType,
            status: classification.mood === 'ambient'
                ? 'idle'
                : classification.mood === 'tense'
                    ? 'error'
                    : classification.mood === 'triumphant'
                        ? 'success'
                        : 'working',
            intensity: Math.round(classification.intensity / 10),
            currentTask: activity.rawText.substring(0, 100),
            mood: classification.mood,
        };

        void this.handleStateChange(legacyState);
    }

    public async handleStateChange(newState: AgentState): Promise<void> {
        if (!this.shouldUpdateMusic(newState)) return;

        this.state = newState;

        if (newState.mood) {
            this.currentMood = newState.mood;
        }

        if (newState.status === 'idle' && !this.isPlaying) {
            return;
        }

        // Legacy state updates are advisory only; start behavior is driven by activity handlers/commands.
    }

    private shouldUpdateMusic(newState: AgentState): boolean {
        return newState.status !== this.state.status || newState.intensity !== this.state.intensity;
    }

    public async startFlowFromActivity(activity: AgentActivity, agentCount?: number): Promise<void> {
        if (this.isPlaying) return;
        this.handleActivity(activity, agentCount);
        await this.startFlow(activity.rawText);
    }

    public async startFlow(customPromptHint?: string): Promise<void> {
        if (this.isPlaying) return;

        const mode = this.selectPreferredEngine();
        this.logRouting(`startFlow:${customPromptHint ? 'activity' : 'manual'}`);
        if (mode === 'lyria') {
            const started = await this.startRealtimeFlow(customPromptHint);
            if (started) {
                return;
            }

            // When Lyria is configured/present but errors, do not silently switch to Suno.
            vscode.window.showErrorMessage('AgenticSuno: Lyria failed to start. Check logs and API/model settings.');
            return;
        }

        await this.startSunoFlow(customPromptHint);
    }

    public startFlowWithImmediatePlayback(): void {
        if (this.isPlaying) return;

        const mode = this.selectPreferredEngine();
        if (mode === 'lyria') {
            void this.startFlow();
            return;
        }

        const theme = this.projectTheme;
        const hasThemeUrl = theme?.track?.audio_url;

        if (hasThemeUrl) {
            this.isPlaying = true;
            this.isPaused = false;
            this.realtimeActive = false;
            this.currentMood = theme?.track?.mood ?? 'ambient';
            this.currentIntensity = 30;
            this.setPlaybackOrigin('library_url', 'startFlowWithImmediate:theme-url');

            this.playerProvider.updateState({
                mood: this.currentMood,
                intensity: this.currentIntensity,
                agentCount: this.activeAgentCount,
            });
            this.playerProvider.playTrackWhenReady(
                theme.track?.audio_url ?? '',
                theme.track?.title ?? 'Project theme',
                theme?.style ?? theme?.prompt.substring(0, 50),
                theme?.track?.mood,
            );
            return;
        }

        this.currentMood = 'focused';
        this.currentIntensity = 30;
        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
            agentCount: this.activeAgentCount,
        });

        const mockTrack = this.generationEngine.getMockTrackForMood(this.currentMood);
        this.isPlaying = true;
        this.isPaused = false;
        this.realtimeActive = false;
        this.setPlaybackOrigin('suno_generated', 'startFlowWithImmediate:mock');

        this.playerProvider.playTrackWhenReady(
            mockTrack.audio_url,
            mockTrack.title ?? `Mock (${this.currentMood})`,
            String(mockTrack.metadata?.tags ?? this.currentMood),
            this.currentMood,
        );

        this.startBackgroundGeneration();

        void this.getRepositoryMood().then((repoMood) => {
            this.currentMood = repoMood;
            this.playerProvider.updateState({
                mood: this.currentMood,
                intensity: this.currentIntensity,
                agentCount: this.activeAgentCount,
            });
        });
    }

    private async startRealtimeFlow(
        customPromptHint?: string,
        preset?: { prompts?: LyriaWeightedPrompt[]; config?: LyriaGenerationConfig }
    ): Promise<boolean> {
        this.lyriaEngine.configure(this.getGeminiApiKey(), this.getLyriaModel());

        const apiKey = this.getGeminiApiKey();
        if (!apiKey) {
            return false;
        }

        try {
            this.startGenerationTimer();
            this.stopExtensionScheduler();
            this.queue = [];
            this.currentTrack = undefined;

            const steering = await this.buildRealtimeSteering(customPromptHint, preset);

            await this.lyriaEngine.startSession(steering.prompts, steering.config);

            this.stopGenerationTimer();
            this.showGenerationMetrics({
                requestStartTime: this.generationStartTime,
                completionTime: Date.now(),
                elapsedMs: Date.now() - this.generationStartTime,
                pollAttempts: 1,
            });

            this.isPlaying = true;
            this.isPaused = false;
            this.realtimeActive = true;
            this.setPlaybackOrigin('lyria_realtime', 'startRealtimeFlow');

            this.upsertRealtimeProjectTheme(steering.prompt, steering.prompts, steering.config);
            this.addRealtimePresetToLibrary(steering.prompt, steering.prompts, steering.config);

            return true;
        } catch (error) {
            this.stopGenerationTimer();
            const message = error instanceof Error ? error.message : String(error);
            console.error('MusicManager: Failed to start Lyria realtime, using Suno fallback:', message);
            this.playerProvider.streamError(`Lyria start failed: ${message}`);
            this.realtimeActive = false;
            this.isPlaying = false;
            this.isPaused = false;
            this.setPlaybackOrigin('idle', 'startRealtimeFlow:failed');
            return false;
        }
    }

    private async steerRealtimeSession(customPromptHint?: string, aggregated?: AggregatedSignal): Promise<void> {
        if (!this.realtimeActive || !this.isPlaying) return;

        try {
            const steering = await this.buildRealtimeSteering(customPromptHint, undefined, {
                aggregated,
            });
            await this.lyriaEngine.steer(steering.prompts, steering.config);
            this.upsertRealtimeProjectTheme(steering.prompt, steering.prompts, steering.config);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('MusicManager: Realtime steering failed:', message);
            this.playerProvider.streamError(`Lyria steer failed: ${message}`);
        }
    }

    private async buildRealtimeSteering(
        customPromptHint?: string,
        preset?: { prompts?: LyriaWeightedPrompt[]; config?: LyriaGenerationConfig },
        options?: {
            aggregated?: AggregatedSignal;
            variationTag?: string;
            forceNewSeed?: boolean;
            skipVariation?: number;
        }
    ): Promise<{ prompt: string; prompts: LyriaWeightedPrompt[]; config: LyriaGenerationConfig }> {
        const aggregated = options?.aggregated ?? this.aggregateSignal();
        const evolutionStrength = this.getLyriaEvolutionStrength();
        const skipVariation = options?.skipVariation ?? this.getLyriaSkipVariation();
        const projectThemePrompt = this.projectTheme?.prompt ?? await this.deriveProjectThemePrompt() ?? undefined;
        const prompt = this.blendContentHint(this.getPromptForMood(aggregated.mood, aggregated.intensity), customPromptHint);

        const prompts = preset?.prompts ?? buildWeightedPrompts({
            mood: aggregated.mood,
            intensity: aggregated.intensity,
            promptHint: customPromptHint,
            projectThemePrompt,
            styleAnchor: this.getLyriaStyleAnchor(),
            evolutionStrength,
            activityDensity: aggregated.activityDensity,
            moodDelta: aggregated.moodDelta,
            promptVariation: options?.variationTag,
            skipVariation,
        });

        const config = preset?.config ?? this.projectTheme?.generationConfig ?? buildGenerationConfig({
            mood: aggregated.mood,
            intensity: aggregated.intensity,
            evolutionStrength,
            activityDensity: aggregated.activityDensity,
            moodDelta: aggregated.moodDelta,
            skipVariation,
            seed: options?.forceNewSeed ? this.generateFreshSeed() : undefined,
        });

        return { prompt, prompts, config };
    }

    private async startSunoFlow(customPromptHint?: string): Promise<void> {
        if (this.isPlaying) return;
        if (!this.isSunoGenerationAllowed()) {
            console.log('MusicManager: Suno generation blocked because Lyria is available and preferred.');
            return;
        }

        this.isPlaying = true;
        this.isPaused = false;
        this.realtimeActive = false;
        this.setPlaybackOrigin('suno_generated', 'startSunoFlow');

        try {
            const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
            let cachedTracks = this.moodCache.get(this.currentMood);

            if ((!cachedTracks || cachedTracks.length === 0) && this.pendingGenerations.has(this.currentMood)) {
                await this.pendingGenerations.get(this.currentMood);
                cachedTracks = this.moodCache.get(this.currentMood);
            }

            if (cachedTracks && cachedTracks.length > 0) {
                const track = cachedTracks.shift();
                this.moodCache.set(this.currentMood, cachedTracks);

                if (track) {
                    this.queue.push(track);
                    this.addToLibrary(track, {
                        prompt,
                        style: this.getPromptForMood(this.currentMood, this.currentIntensity),
                        engine: 'suno',
                    });
                    this.playNext();
                    this.startExtensionScheduler();
                    void this.generateInBackground(this.currentMood);
                    return;
                }
            }

            this.startGenerationTimer();
            const finalPrompt = this.blendContentHint(prompt, customPromptHint);
            const result = await this.generationEngine.generate(finalPrompt);

            this.stopGenerationTimer();
            this.showGenerationMetrics(result.metrics);

            if (result.tracks && result.tracks.length > 0) {
                for (const t of result.tracks) {
                    this.addToLibrary(t, {
                        prompt: finalPrompt,
                        style: this.getPromptForMood(this.currentMood, this.currentIntensity),
                        engine: 'suno',
                    });
                }
                this.queue.push(...result.tracks);
                this.playNext();
                this.startExtensionScheduler();
            }
        } catch (error) {
            console.error('MusicManager: Suno fallback generation error:', error);
            this.stopGenerationTimer();
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate fallback music.');
            this.isPlaying = false;
            this.isPaused = false;
            this.setPlaybackOrigin('idle', 'startSunoFlow:error');
        }
    }

    private startBackgroundGeneration(): void {
        if (!this.isSunoGenerationAllowed() || this.realtimeActive || this.playbackOrigin === 'library_url') {
            return;
        }

        this.startGenerationTimer();
        const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);

        this.generationEngine.generate(prompt).then((result: GenerateResult) => {
            if (!this.isPlaying || this.realtimeActive) return;

            this.stopGenerationTimer();
            this.showGenerationMetrics(result.metrics);

            if (result.tracks && result.tracks.length > 0) {
                const style = this.getPromptForMood(this.currentMood, this.currentIntensity);
                for (const t of result.tracks) {
                    this.addToLibrary(t, { prompt, style, engine: 'suno' });
                }

                this.queue.push(...result.tracks);
                this.currentTrack = result.tracks[0];
                const first = result.tracks[0];
                this.playerProvider.playTrack(
                    first.audio_url,
                    first.title ?? 'Generated Track',
                    style,
                    this.currentMood,
                );
                this.startExtensionScheduler();
            }
        }).catch((error) => {
            console.error('MusicManager: Background generation error:', error);
            this.stopGenerationTimer();
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate music.');
            this.isPlaying = false;
            this.isPaused = false;
            this.setPlaybackOrigin('idle', 'startBackgroundGeneration:error');
            this.playerProvider.stop();
        });
    }

    public stop(): void {
        this.isPlaying = false;
        this.isPaused = false;
        this.queue = [];
        this.currentTrack = undefined;
        this.stopExtensionScheduler();

        if (this.realtimeActive) {
            this.realtimeActive = false;
            void this.lyriaEngine.stop();
        }

        this.setPlaybackOrigin('idle', 'stop');
        this.playerProvider.stop();
    }

    public pause(): void {
        if (!this.isPlaying || this.isPaused) return;

        this.isPaused = true;
        if (this.realtimeActive) {
            void this.lyriaEngine.pause();
        } else {
            this.playerProvider.pause();
        }
    }

    public resume(): void {
        if (!this.isPlaying || !this.isPaused) return;

        this.isPaused = false;
        if (this.realtimeActive) {
            void this.lyriaEngine.resume();
        } else {
            this.playerProvider.resume();
        }
    }

    public async skip(): Promise<void> {
        if (!this.isPlaying) return;

        if (this.realtimeActive) {
            const variationTag = `skip-${++this.skipCounter}-${Date.now().toString(36)}`;
            const steering = await this.buildRealtimeSteering(this.lastActivityHint, undefined, {
                aggregated: this.aggregateSignal(),
                variationTag,
                forceNewSeed: true,
                skipVariation: this.getLyriaSkipVariation(),
            });
            await this.lyriaEngine.skip(steering.prompts, steering.config);
            return;
        }

        if (this.playbackOrigin === 'library_url') {
            const latestHint = this.lastActivityHint;
            this.stop();
            await this.startFlow(latestHint);
            return;
        }

        if (this.queue.length > 0) {
            this.playNext();
        } else {
            await this.extendFlow();
            this.playNext();
        }
    }

    public updateTimeRemaining(_currentTime: number, _duration: number, remaining: number): void {
        this.remainingTime = remaining;
    }

    private playNext(): void {
        if (this.realtimeActive || this.queue.length === 0) return;

        this.currentTrack = this.queue.shift();
        if (this.currentTrack) {
            this.setPlaybackOrigin('suno_generated', 'playNext');
            this.playerProvider.playTrack(
                this.currentTrack.audio_url,
                this.currentTrack.title || 'Generated Track',
                this.currentTrack.metadata?.tags || this.getPromptForMood(this.currentMood, this.currentIntensity),
                this.currentMood,
            );
        }

        if (this.queue.length < 2) {
            void this.extendFlow();
        }
    }

    private startExtensionScheduler(): void {
        if (!this.isSunoGenerationAllowed() || this.playbackOrigin === 'library_url') {
            return;
        }

        this.stopExtensionScheduler();

        this.extensionTimer = setInterval(() => {
            if (this.realtimeActive) return;

            if (this.remainingTime > 0 && this.remainingTime < this.EXTENSION_THRESHOLD) {
                if (this.queue.length === 0) {
                    void this.extendFlow();
                }
            }
        }, 5000);
    }

    private stopExtensionScheduler(): void {
        if (this.extensionTimer) {
            clearInterval(this.extensionTimer);
            this.extensionTimer = undefined;
        }
    }

    private async extendFlow(): Promise<void> {
        if (this.realtimeActive || !this.currentTrack || !this.isSunoGenerationAllowed() || this.playbackOrigin === 'library_url') return;

        try {
            const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
            this.startGenerationTimer();

            const result = await this.generationEngine.extend(this.currentTrack.id, prompt);

            this.stopGenerationTimer();
            this.showGenerationMetrics(result.metrics);

            if (result.tracks && result.tracks.length > 0) {
                const style = this.getPromptForMood(this.currentMood, this.currentIntensity);
                for (const t of result.tracks) {
                    this.addToLibrary(t, { prompt, style, engine: 'suno' });
                }
                this.queue.push(...result.tracks);
            }
        } catch (error) {
            console.error('MusicManager: Extension error:', error);
            this.stopGenerationTimer();

            try {
                const result = await this.generationEngine.generate(this.getPromptForMood(this.currentMood, this.currentIntensity));
                if (result.tracks && result.tracks.length > 0) {
                    this.queue.push(...result.tracks);
                }
            } catch (fallbackError) {
                console.error('MusicManager: Fallback extension generation failed:', fallbackError);
            }
        }
    }

    private startGenerationTimer(): void {
        this.stopGenerationTimer();
        this.generationStartTime = Date.now();
        this.playerProvider.showGenerating(0);

        this.generationIntervalId = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.generationStartTime) / 1000);
            this.playerProvider.showGenerating(elapsedSeconds);
        }, 1000);
    }

    private stopGenerationTimer(): void {
        if (this.generationIntervalId) {
            clearInterval(this.generationIntervalId);
            this.generationIntervalId = undefined;
        }
    }

    private showGenerationMetrics(metrics: GenerationMetrics): void {
        const seconds = (metrics.elapsedMs / 1000).toFixed(1);
        vscode.window.setStatusBarMessage(`AgenticSuno: Music ready in ${seconds}s`, 2500);
        this.playerProvider.showGenerationComplete(parseFloat(seconds));
    }

    private blendContentHint(basePrompt: string, contentHint?: string): string {
        if (!contentHint || contentHint.length < 5) return basePrompt;
        const sanitized = contentHint.replace(/\s+/g, ' ').trim().substring(0, 80);
        if (sanitized.length < 5) return basePrompt;
        return `${basePrompt}, inspired by: ${sanitized}`;
    }

    private getPromptForMood(mood: Mood, intensity: number): string {
        const config = vscode.workspace.getConfiguration('agenticSuno');

        const moodPrompts: Record<Mood, string> = {
            epic: 'cinematic electronic drive, bold momentum, expressive peaks, anthemic energy',
            tense: 'nocturnal pulse, unresolved harmony, controlled pressure, dramatic suspense',
            triumphant: 'uplifting melodic contour, bright confidence, celebratory forward motion',
            focused: config.get('styles.working') || 'deep groove, focused momentum, clean modern textures',
            ambient: 'atmospheric layers, warm harmonics, spacious flow, gentle movement',
        };

        let prompt = moodPrompts[mood];

        if (intensity > 70) {
            prompt += ', fast tempo, intense, energetic';
        } else if (intensity > 50) {
            prompt += ', medium tempo, steady';
        } else if (intensity < 30) {
            prompt += ', slow tempo, gentle, soft';
        }
        return prompt;
    }

    public getCurrentMood(): Mood {
        return this.currentMood;
    }

    public isCurrentlyPlaying(): boolean {
        return this.isPlaying;
    }

    public setAgentCount(agentCount: number): void {
        this.activeAgentCount = Math.max(0, Math.floor(agentCount));
        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
            agentCount: this.activeAgentCount,
        });
    }

    // ---------- Persisted library & project theme ----------

    public loadPersistedLibrary(): void {
        try {
            const rawLibrary = this.workspaceState.get<PersistedTrack[]>(WORKSPACE_STATE_KEY_LIBRARY);
            this.library = Array.isArray(rawLibrary) ? rawLibrary : [];

            const rawTheme = this.workspaceState.get<StoredProjectTheme>(WORKSPACE_STATE_KEY_PROJECT_THEME);
            this.projectTheme = rawTheme && typeof rawTheme.prompt === 'string' ? rawTheme : null;

            this.playerProvider.setLibrary(this.library);
            this.playerProvider.setProjectThemeAvailable(!!this.projectTheme);
            this.playerProvider.updateState({
                mood: this.currentMood,
                intensity: this.currentIntensity,
                agentCount: this.activeAgentCount,
            });
        } catch (error) {
            console.error('MusicManager: loadPersistedLibrary error', error);
        }
    }

    public getProjectTheme(): StoredProjectTheme | null {
        return this.projectTheme;
    }

    public getLibrary(): PersistedTrack[] {
        return [...this.library];
    }

    public setProjectTheme(track: MusicTrack, prompt: string, style?: string): void {
        const persisted: PersistedTrack = {
            id: track.id,
            audio_url: track.audio_url,
            title: track.title,
            mood: this.currentMood,
            generatedAt: Date.now(),
            prompt,
            style,
            engine: 'suno',
        };

        this.projectTheme = {
            track: persisted,
            prompt,
            style,
            generatedAt: persisted.generatedAt,
            engine: 'suno',
        };

        void this.workspaceState.update(WORKSPACE_STATE_KEY_PROJECT_THEME, this.projectTheme);
        this.playerProvider.setProjectThemeAvailable(true);
    }

    private upsertRealtimeProjectTheme(
        prompt: string,
        weightedPrompts: LyriaPromptWeight[],
        generationConfig: LyriaGenerationPreset,
    ): void {
        this.projectTheme = {
            ...this.projectTheme,
            prompt,
            style: this.projectTheme?.style ?? 'Lyria realtime preset',
            generatedAt: Date.now(),
            engine: 'lyria',
            weightedPrompts,
            generationConfig,
        };

        void this.workspaceState.update(WORKSPACE_STATE_KEY_PROJECT_THEME, this.projectTheme);
        this.playerProvider.setProjectThemeAvailable(true);
    }

    public addToLibrary(track: MusicTrack, options?: {
        prompt?: string;
        style?: string;
        engine?: MusicEngineMode;
        weightedPrompts?: LyriaPromptWeight[];
        generationConfig?: LyriaGenerationPreset;
    }): void {
        const persisted: PersistedTrack = {
            id: track.id,
            audio_url: track.audio_url,
            title: track.title,
            mood: this.currentMood,
            generatedAt: Date.now(),
            prompt: options?.prompt,
            style: options?.style,
            engine: options?.engine ?? 'suno',
            weightedPrompts: options?.weightedPrompts,
            generationConfig: options?.generationConfig,
        };

        this.library.unshift(persisted);
        if (this.library.length > LIBRARY_MAX_TRACKS) {
            this.library = this.library.slice(0, LIBRARY_MAX_TRACKS);
        }

        this.persistLibrary();
        this.playerProvider.setLibrary(this.library);
    }

    private addRealtimePresetToLibrary(
        prompt: string,
        weightedPrompts: LyriaPromptWeight[],
        generationConfig: LyriaGenerationPreset,
    ): void {
        const newest = this.library[0];
        if (
            newest &&
            newest.engine === 'lyria' &&
            newest.prompt === prompt &&
            Date.now() - newest.generatedAt < 120000
        ) {
            return;
        }

        const persisted: PersistedTrack = {
            id: `lyria-${Date.now()}`,
            title: `Lyria preset (${this.currentMood})`,
            mood: this.currentMood,
            generatedAt: Date.now(),
            prompt,
            style: 'Realtime preset',
            engine: 'lyria',
            weightedPrompts,
            generationConfig,
        };

        this.library.unshift(persisted);
        if (this.library.length > LIBRARY_MAX_TRACKS) {
            this.library = this.library.slice(0, LIBRARY_MAX_TRACKS);
        }

        this.persistLibrary();
        this.playerProvider.setLibrary(this.library);
    }

    private persistLibrary(): void {
        try {
            void this.workspaceState.update(WORKSPACE_STATE_KEY_LIBRARY, this.library);
        } catch (error) {
            console.error('MusicManager: persistLibrary error', error);
        }
    }

    private async getRepositoryText(): Promise<string | null> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return null;

        const parts: string[] = [];
        if (folder.name) {
            parts.push(`Adaptive music theme for project ${folder.name}`);
        }

        try {
            const readmeUri = vscode.Uri.joinPath(folder.uri, 'README.md');
            const readmeData = await Promise.resolve(vscode.workspace.fs.readFile(readmeUri)).catch(() => null);
            if (readmeData) {
                const text = Buffer.from(readmeData)
                    .toString('utf8')
                    .replace(/#+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 300);
                if (text.length > 20) {
                    parts.push(text);
                }
            }
        } catch {
            // ignore
        }

        const specFiles = ['spec/intent.md', 'spec/requirements.md', 'spec/design.md'];
        for (const rel of specFiles) {
            try {
                const uri = vscode.Uri.joinPath(folder.uri, rel);
                const data = await Promise.resolve(vscode.workspace.fs.readFile(uri)).catch(() => null);
                if (data) {
                    const text = Buffer.from(data)
                        .toString('utf8')
                        .replace(/#+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .substring(0, 200);
                    if (text.length > 15) {
                        parts.push(text);
                    }
                    break;
                }
            } catch {
                // ignore
            }
        }

        try {
            const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json');
            const data = await Promise.resolve(vscode.workspace.fs.readFile(pkgUri)).catch(() => null);
            if (data) {
                const json = JSON.parse(Buffer.from(data).toString('utf8'));
                if (json?.name) parts.push(`Project: ${json.name}`);
                if (typeof json?.description === 'string') {
                    parts.push(json.description.substring(0, 120));
                }
            }
        } catch {
            // ignore
        }

        if (parts.length === 0) return null;
        return parts.join('. ').substring(0, PROJECT_THEME_PROMPT_MAX_CHARS);
    }

    public async deriveProjectThemePrompt(): Promise<string | null> {
        const combined = await this.getRepositoryText();
        if (!combined) return null;
        return `${combined}, expressive modern composition`;
    }

    public async getRepositoryMood(): Promise<Mood> {
        const text = await this.getRepositoryText();
        if (!text || text.length < 10) return 'focused';
        const classification = this.classifier.classify(text);
        return classification.mood;
    }

    public async ensureProjectTheme(): Promise<void> {
        if (this.playbackOrigin === 'lyria_realtime' || this.playbackOrigin === 'library_url') {
            return;
        }

        if (this.projectTheme?.prompt) {
            this.playerProvider.setProjectThemeAvailable(true);
            return;
        }

        const prompt = await this.deriveProjectThemePrompt();
        if (!prompt) return;

        this.projectTheme = {
            prompt,
            style: 'Workspace-derived theme',
            generatedAt: Date.now(),
            engine: this.selectPreferredEngine() === 'lyria' ? 'lyria' : 'suno',
        };
        await this.workspaceState.update(WORKSPACE_STATE_KEY_PROJECT_THEME, this.projectTheme);
        this.playerProvider.setProjectThemeAvailable(true);

        if (this.projectTheme.engine === 'suno' && this.isSunoGenerationAllowed()) {
            try {
                const result = await this.generationEngine.generate(prompt, true, true);
                if (result.tracks && result.tracks.length > 0) {
                    const track = result.tracks[0];
                    this.setProjectTheme(track, prompt);
                    this.addToLibrary(track, { prompt, engine: 'suno' });
                }
            } catch (error) {
                console.error('MusicManager: ensureProjectTheme generation error', error);
            }
        }
    }

    public async playProjectTheme(): Promise<void> {
        if (this.isPlaying) return;

        const theme = this.projectTheme;

        if (this.selectPreferredEngine() === 'lyria') {
            const started = await this.startRealtimeFlow(theme?.prompt, {
                prompts: theme?.weightedPrompts,
                config: theme?.generationConfig,
            });
            if (started) {
                return;
            }

            vscode.window.showErrorMessage('AgenticSuno: Lyria failed to start. Check logs and API/model settings.');
            return;
        }

        if (theme?.track?.audio_url) {
            this.isPlaying = true;
            this.realtimeActive = false;
            this.isPaused = false;
            this.currentMood = theme.track.mood ?? 'ambient';
            this.setPlaybackOrigin('library_url', 'playProjectTheme:url');
            this.playerProvider.updateState({
                mood: this.currentMood,
                intensity: this.currentIntensity,
                agentCount: this.activeAgentCount,
            });
            this.playerProvider.playTrack(
                theme.track.audio_url,
                theme.track.title ?? 'Project theme',
                theme.style ?? theme.prompt.substring(0, 50),
                theme.track.mood,
            );
            return;
        }

        await this.startFlow(theme?.prompt);
    }

    public playLibraryTrack(index: number): void {
        const track = this.library[index];
        if (!track) return;
        this.playLibraryTrackById(track.id);
    }

    public playLibraryTrackById(trackId: string): void {
        const track = this.library.find((entry) => entry.id === trackId);
        if (!track) return;

        this.logRouting(`playLibraryTrackById:${track.engine ?? 'unknown'}`);
        if (this.isPlaying) {
            this.stop();
        }

        if (track.engine === 'lyria' || !track.audio_url) {
            this.currentMood = track.mood ?? this.currentMood;
            this.currentIntensity = Math.max(this.currentIntensity, 40);
            this.aggregatedMood = this.currentMood;
            this.aggregatedIntensity = this.currentIntensity;
            void this.startRealtimeFlow(track.prompt, {
                prompts: track.weightedPrompts,
                config: track.generationConfig,
            });
            return;
        }

        this.isPlaying = true;
        this.isPaused = false;
        this.realtimeActive = false;
        this.currentMood = track.mood ?? 'ambient';
        this.currentTrack = {
            id: track.id,
            audio_url: track.audio_url,
            title: track.title,
            status: 'complete',
        };
        this.setPlaybackOrigin('library_url', 'playLibraryTrackById:url');
        this.stopExtensionScheduler();

        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
            agentCount: this.activeAgentCount,
        });
        this.playerProvider.playTrack(
            track.audio_url,
            track.title ?? 'Library track',
            track.style ?? track.prompt?.substring(0, 50) ?? '',
            track.mood,
        );
    }

    private selectPreferredEngine(notifyMissingKey: boolean = true): MusicEngineMode {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        const preference = config.get<'auto' | MusicEngineMode>('engine') ?? 'auto';

        if (preference === 'suno') {
            return 'suno';
        }

        const hasGeminiKey = this.getGeminiApiKey().length > 0;

        if (preference === 'lyria') {
            if (!hasGeminiKey) {
                if (notifyMissingKey) {
                    vscode.window.setStatusBarMessage('AgenticSuno: geminiApiKey missing, falling back to Suno/mock.', 3000);
                }
                return 'suno';
            }
            return 'lyria';
        }

        return hasGeminiKey ? 'lyria' : 'suno';
    }

    private isSunoGenerationAllowed(): boolean {
        const preferred = this.selectPreferredEngine(false);
        if (preferred === 'suno') {
            return true;
        }
        return this.getGeminiApiKey().length === 0;
    }

    private getGeminiApiKey(): string {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get<string>('geminiApiKey') || '').trim();
    }

    private getLyriaModel(): string {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get<string>('lyriaModel') || 'models/lyria-realtime-exp').trim();
    }

    private getLyriaStyleAnchor(): string {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get<string>('lyriaStyleAnchor') || '').trim();
    }

    private getLyriaEvolutionStrength(): 'subtle' | 'balanced' | 'strong' {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        const raw = config.get<string>('lyriaEvolutionStrength');
        if (raw === 'subtle' || raw === 'balanced' || raw === 'strong') {
            return raw;
        }
        return 'strong';
    }

    private getLyriaSkipVariation(): number {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        const value = Number(config.get<number>('lyriaSkipVariation'));
        if (Number.isFinite(value)) {
            return Math.max(0, Math.min(1, value));
        }
        return 0.85;
    }

    private generateFreshSeed(): number {
        return Math.floor(Math.random() * 2_000_000_000);
    }

    private logRouting(reason: string): void {
        const preferredEngine = this.selectPreferredEngine(false);
        console.log(
            `MusicManager: routing reason=${reason} origin=${this.playbackOrigin} preferred=${preferredEngine} sunoGenerationAllowed=${this.isSunoGenerationAllowed()}`
        );
    }

    private setPlaybackOrigin(origin: PlaybackOrigin, reason: string): void {
        this.playbackOrigin = origin;
        this.logRouting(reason);
    }

    private pushActivitySignal(activity: AgentActivity, mood: Mood, intensity: number): void {
        const hint = activity.rawText.replace(/\s+/g, ' ').trim().substring(0, 160);
        this.activitySignals.push({
            timestamp: activity.timestamp || Date.now(),
            mood,
            intensity: Math.max(0, Math.min(100, intensity)),
            hint,
        });

        if (this.activitySignals.length > this.MAX_SIGNAL_WINDOW) {
            this.activitySignals = this.activitySignals.slice(this.activitySignals.length - this.MAX_SIGNAL_WINDOW);
        }
    }

    private aggregateSignal(): AggregatedSignal {
        const now = Date.now();
        const cutoff = now - this.SIGNAL_WINDOW_MS;
        this.activitySignals = this.activitySignals.filter((signal) => signal.timestamp >= cutoff);

        if (this.activitySignals.length === 0) {
            return {
                mood: this.currentMood,
                intensity: this.currentIntensity,
                hint: this.lastActivityHint || undefined,
                activityDensity: 0,
                moodDelta: 0,
            };
        }

        const moodWeights = new Map<Mood, number>();
        let ewmaIntensity = this.aggregatedIntensity;
        let weightedDensity = 0;

        for (const signal of this.activitySignals) {
            const age = Math.max(0, now - signal.timestamp);
            const recencyWeight = Math.exp(-age / this.SIGNAL_HALF_LIFE_MS);
            moodWeights.set(signal.mood, (moodWeights.get(signal.mood) || 0) + recencyWeight);
            ewmaIntensity = ewmaIntensity * (1 - this.EWMA_ALPHA) + signal.intensity * this.EWMA_ALPHA;
            weightedDensity += recencyWeight;
        }

        let dominantMood: Mood = this.aggregatedMood;
        let maxWeight = -1;
        for (const [mood, weight] of moodWeights.entries()) {
            if (weight > maxWeight) {
                dominantMood = mood;
                maxWeight = weight;
            }
        }

        const intensity = Math.round(Math.max(0, Math.min(100, ewmaIntensity)));
        const activityDensity = Math.max(0, Math.min(1, weightedDensity / 6));
        const moodChanged = dominantMood !== this.aggregatedMood ? 0.55 : 0.12;
        const intensityDelta = Math.abs(intensity - this.aggregatedIntensity) / 100;
        const moodDelta = Math.max(0, Math.min(1, moodChanged + intensityDelta * 0.55 + activityDensity * 0.35));
        const hint = this.activitySignals[this.activitySignals.length - 1]?.hint || this.lastActivityHint;

        return {
            mood: dominantMood,
            intensity,
            hint: hint || undefined,
            activityDensity,
            moodDelta,
        };
    }

    public dispose(): void {
        this.stop();
        this.lyriaEngine.dispose();
    }
}
