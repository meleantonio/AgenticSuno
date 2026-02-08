"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusicManager = void 0;
const vscode = __importStar(require("vscode"));
const MoodClassifier_1 = require("../classification/MoodClassifier");
const LyriaSteering_1 = require("./LyriaSteering");
const engine_1 = require("./engine");
const WORKSPACE_STATE_KEY_LIBRARY = 'agenticSuno.library';
const WORKSPACE_STATE_KEY_PROJECT_THEME = 'agenticSuno.projectTheme';
const LIBRARY_MAX_TRACKS = 50;
const PROJECT_THEME_PROMPT_MAX_CHARS = 400;
class MusicManager {
    playerProvider;
    workspaceState;
    generationEngine;
    classifier;
    lyriaEngine;
    queue = [];
    currentTrack;
    state = { source: 'antigravity', status: 'idle', intensity: 1 };
    isPlaying = false;
    isPaused = false;
    currentMood = 'ambient';
    currentIntensity = 30;
    // Legacy Suno extension scheduling
    extensionTimer;
    remainingTime = 0;
    EXTENSION_THRESHOLD = 15; // seconds
    // Generation timer UI
    generationStartTime = 0;
    generationIntervalId;
    // Debounce steering/extend-on-activity
    lastSteerOrExtendTime = 0;
    STEER_DEBOUNCE_MS = 2500;
    EXTEND_ON_ACTIVITY_DEBOUNCE_MS = 12000;
    // Background cache for Suno fallback
    moodCache = new Map();
    pendingGenerations = new Map();
    // Persisted library and project theme (per-workspace)
    library = [];
    projectTheme = null;
    // Realtime session flags
    realtimeActive = false;
    constructor(playerProvider, workspaceState) {
        this.playerProvider = playerProvider;
        this.workspaceState = workspaceState;
        this.generationEngine = new engine_1.SunoEngineAdapter();
        this.classifier = new MoodClassifier_1.MoodClassifier();
        this.lyriaEngine = new engine_1.LyriaEngineAdapter(this.getGeminiApiKey(), this.getLyriaModel(), {
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
        });
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('agenticSuno.geminiApiKey') ||
                event.affectsConfiguration('agenticSuno.lyriaModel')) {
                this.lyriaEngine.configure(this.getGeminiApiKey(), this.getLyriaModel());
            }
        });
        console.log('MusicManager: Initialized with Suno fallback + Lyria realtime support');
        this.initializeCache();
    }
    initializeCache() {
        if (this.selectPreferredEngine() !== 'suno') {
            console.log('MusicManager: Skipping fallback cache warmup because Lyria is preferred.');
            return;
        }
        setTimeout(() => {
            console.log('MusicManager: Initializing fallback cache...');
            void this.generateInBackground('focused');
            void this.generateInBackground('ambient');
        }, 3000);
    }
    async generateInBackground(mood) {
        if (this.pendingGenerations.has(mood))
            return;
        const cached = this.moodCache.get(mood) || [];
        if (cached.length > 0)
            return;
        const generationPromise = (async () => {
            try {
                const prompt = this.getPromptForMood(mood, 30);
                const result = await this.generationEngine.generate(prompt, true, true);
                if (result.tracks && result.tracks.length > 0) {
                    const currentCache = this.moodCache.get(mood) || [];
                    currentCache.push(...result.tracks);
                    this.moodCache.set(mood, currentCache);
                }
            }
            catch (error) {
                console.error(`MusicManager: Failed to cache ${mood} fallback tracks`, error);
            }
            finally {
                this.pendingGenerations.delete(mood);
            }
        })();
        this.pendingGenerations.set(mood, generationPromise);
        await generationPromise;
    }
    handleActivity(activity) {
        const classification = activity.rawText.length > 20
            ? this.classifier.classify(activity.rawText)
            : activity.classification;
        const prevMood = this.currentMood;
        const prevIntensity = this.currentIntensity;
        this.currentMood = classification.mood;
        this.currentIntensity = classification.intensity;
        this.playerProvider.updateState({
            mood: this.currentMood,
            intensity: this.currentIntensity,
        });
        this.playerProvider.addActivity({
            ...activity,
            classification,
        });
        const moodOrIntensityChanged = prevMood !== this.currentMood || Math.abs(prevIntensity - this.currentIntensity) > 15;
        const now = Date.now();
        if (this.isPlaying && moodOrIntensityChanged) {
            if (this.realtimeActive) {
                const debounceOk = now - this.lastSteerOrExtendTime >= this.STEER_DEBOUNCE_MS;
                if (debounceOk) {
                    this.lastSteerOrExtendTime = now;
                    void this.steerRealtimeSession(activity.rawText);
                }
            }
            else {
                const debounceOk = now - this.lastSteerOrExtendTime >= this.EXTEND_ON_ACTIVITY_DEBOUNCE_MS;
                if (debounceOk) {
                    this.lastSteerOrExtendTime = now;
                    void this.extendFlow();
                }
            }
        }
        const legacyState = {
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
    async handleStateChange(newState) {
        if (!this.shouldUpdateMusic(newState))
            return;
        this.state = newState;
        if (newState.mood) {
            this.currentMood = newState.mood;
        }
        if (newState.status === 'idle' && !this.isPlaying) {
            return;
        }
        if (newState.status === 'working' && !this.isPlaying) {
            await this.startFlow();
        }
    }
    shouldUpdateMusic(newState) {
        return newState.status !== this.state.status || newState.intensity !== this.state.intensity;
    }
    async startFlowFromActivity(activity) {
        if (this.isPlaying)
            return;
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
        await this.startFlow(activity.rawText);
    }
    async startFlow(customPromptHint) {
        if (this.isPlaying)
            return;
        const mode = this.selectPreferredEngine();
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
    startFlowWithImmediatePlayback() {
        if (this.isPlaying)
            return;
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
            this.playerProvider.updateState({ mood: this.currentMood, intensity: this.currentIntensity });
            this.playerProvider.playTrackWhenReady(theme.track?.audio_url ?? '', theme.track?.title ?? 'Project theme', theme?.style ?? theme?.prompt.substring(0, 50), theme?.track?.mood);
            this.startBackgroundGeneration();
            return;
        }
        this.currentMood = 'focused';
        this.currentIntensity = 30;
        this.playerProvider.updateState({ mood: this.currentMood, intensity: this.currentIntensity });
        const mockTrack = this.generationEngine.getMockTrackForMood(this.currentMood);
        this.isPlaying = true;
        this.isPaused = false;
        this.realtimeActive = false;
        this.playerProvider.playTrackWhenReady(mockTrack.audio_url, mockTrack.title ?? `Mock (${this.currentMood})`, String(mockTrack.metadata?.tags ?? this.currentMood), this.currentMood);
        this.startBackgroundGeneration();
        void this.getRepositoryMood().then((repoMood) => {
            this.currentMood = repoMood;
            this.playerProvider.updateState({ mood: this.currentMood });
        });
    }
    async startRealtimeFlow(customPromptHint, preset) {
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
            this.upsertRealtimeProjectTheme(steering.prompt, steering.prompts, steering.config);
            this.addRealtimePresetToLibrary(steering.prompt, steering.prompts, steering.config);
            return true;
        }
        catch (error) {
            this.stopGenerationTimer();
            const message = error instanceof Error ? error.message : String(error);
            console.error('MusicManager: Failed to start Lyria realtime, using Suno fallback:', message);
            this.playerProvider.streamError(`Lyria start failed: ${message}`);
            this.realtimeActive = false;
            this.isPlaying = false;
            this.isPaused = false;
            return false;
        }
    }
    async steerRealtimeSession(customPromptHint) {
        if (!this.realtimeActive || !this.isPlaying)
            return;
        try {
            const steering = await this.buildRealtimeSteering(customPromptHint);
            await this.lyriaEngine.steer(steering.prompts, steering.config);
            this.upsertRealtimeProjectTheme(steering.prompt, steering.prompts, steering.config);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('MusicManager: Realtime steering failed:', message);
            this.playerProvider.streamError(`Lyria steer failed: ${message}`);
        }
    }
    async buildRealtimeSteering(customPromptHint, preset) {
        const projectThemePrompt = this.projectTheme?.prompt ?? await this.deriveProjectThemePrompt() ?? undefined;
        const prompt = this.blendContentHint(this.getPromptForMood(this.currentMood, this.currentIntensity), customPromptHint);
        const prompts = preset?.prompts ?? (0, LyriaSteering_1.buildWeightedPrompts)({
            mood: this.currentMood,
            intensity: this.currentIntensity,
            promptHint: customPromptHint,
            projectThemePrompt,
            styleAnchor: this.getLyriaStyleAnchor(),
        });
        const config = preset?.config ?? this.projectTheme?.generationConfig ?? (0, LyriaSteering_1.buildGenerationConfig)({
            mood: this.currentMood,
            intensity: this.currentIntensity,
        });
        return { prompt, prompts, config };
    }
    async startSunoFlow(customPromptHint) {
        if (this.isPlaying)
            return;
        this.isPlaying = true;
        this.isPaused = false;
        this.realtimeActive = false;
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
        }
        catch (error) {
            console.error('MusicManager: Suno fallback generation error:', error);
            this.stopGenerationTimer();
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate fallback music.');
            this.isPlaying = false;
            this.isPaused = false;
        }
    }
    startBackgroundGeneration() {
        this.startGenerationTimer();
        const prompt = this.getPromptForMood(this.currentMood, this.currentIntensity);
        this.generationEngine.generate(prompt).then((result) => {
            if (!this.isPlaying || this.realtimeActive)
                return;
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
                this.playerProvider.playTrack(first.audio_url, first.title ?? 'Generated Track', style, this.currentMood);
                this.startExtensionScheduler();
            }
        }).catch((error) => {
            console.error('MusicManager: Background generation error:', error);
            this.stopGenerationTimer();
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate music.');
            this.isPlaying = false;
            this.isPaused = false;
            this.playerProvider.stop();
        });
    }
    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.queue = [];
        this.currentTrack = undefined;
        this.stopExtensionScheduler();
        if (this.realtimeActive) {
            this.realtimeActive = false;
            void this.lyriaEngine.stop();
            this.playerProvider.streamStop();
        }
        this.playerProvider.stop();
    }
    pause() {
        if (!this.isPlaying || this.isPaused)
            return;
        this.isPaused = true;
        if (this.realtimeActive) {
            void this.lyriaEngine.pause();
            this.playerProvider.streamPause();
        }
        else {
            this.playerProvider.pause();
        }
    }
    resume() {
        if (!this.isPlaying || !this.isPaused)
            return;
        this.isPaused = false;
        if (this.realtimeActive) {
            void this.lyriaEngine.resume();
            this.playerProvider.streamResume();
        }
        else {
            this.playerProvider.resume();
        }
    }
    async skip() {
        if (!this.isPlaying)
            return;
        if (this.realtimeActive) {
            const steering = await this.buildRealtimeSteering();
            await this.lyriaEngine.skip(steering.prompts, steering.config);
            return;
        }
        if (this.queue.length > 0) {
            this.playNext();
        }
        else {
            await this.extendFlow();
            this.playNext();
        }
    }
    updateTimeRemaining(_currentTime, _duration, remaining) {
        this.remainingTime = remaining;
    }
    playNext() {
        if (this.realtimeActive || this.queue.length === 0)
            return;
        this.currentTrack = this.queue.shift();
        if (this.currentTrack) {
            this.playerProvider.playTrack(this.currentTrack.audio_url, this.currentTrack.title || 'Generated Track', this.currentTrack.metadata?.tags || this.getPromptForMood(this.currentMood, this.currentIntensity), this.currentMood);
        }
        if (this.queue.length < 2) {
            void this.extendFlow();
        }
    }
    startExtensionScheduler() {
        this.stopExtensionScheduler();
        this.extensionTimer = setInterval(() => {
            if (this.realtimeActive)
                return;
            if (this.remainingTime > 0 && this.remainingTime < this.EXTENSION_THRESHOLD) {
                if (this.queue.length === 0) {
                    void this.extendFlow();
                }
            }
        }, 5000);
    }
    stopExtensionScheduler() {
        if (this.extensionTimer) {
            clearInterval(this.extensionTimer);
            this.extensionTimer = undefined;
        }
    }
    async extendFlow() {
        if (this.realtimeActive || !this.currentTrack)
            return;
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
        }
        catch (error) {
            console.error('MusicManager: Extension error:', error);
            this.stopGenerationTimer();
            try {
                const result = await this.generationEngine.generate(this.getPromptForMood(this.currentMood, this.currentIntensity));
                if (result.tracks && result.tracks.length > 0) {
                    this.queue.push(...result.tracks);
                }
            }
            catch (fallbackError) {
                console.error('MusicManager: Fallback extension generation failed:', fallbackError);
            }
        }
    }
    startGenerationTimer() {
        this.stopGenerationTimer();
        this.generationStartTime = Date.now();
        this.playerProvider.showGenerating(0);
        this.generationIntervalId = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.generationStartTime) / 1000);
            this.playerProvider.showGenerating(elapsedSeconds);
        }, 1000);
    }
    stopGenerationTimer() {
        if (this.generationIntervalId) {
            clearInterval(this.generationIntervalId);
            this.generationIntervalId = undefined;
        }
    }
    showGenerationMetrics(metrics) {
        const seconds = (metrics.elapsedMs / 1000).toFixed(1);
        vscode.window.setStatusBarMessage(`AgenticSuno: Music ready in ${seconds}s`, 2500);
        this.playerProvider.showGenerationComplete(parseFloat(seconds));
    }
    blendContentHint(basePrompt, contentHint) {
        if (!contentHint || contentHint.length < 5)
            return basePrompt;
        const sanitized = contentHint.replace(/\s+/g, ' ').trim().substring(0, 80);
        if (sanitized.length < 5)
            return basePrompt;
        return `${basePrompt}, inspired by: ${sanitized}`;
    }
    getPromptForMood(mood, intensity) {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        const moodPrompts = {
            epic: 'epic orchestral, cinematic, powerful, heroic, dramatic',
            tense: 'dark ambient, tension, suspense, ominous, brooding',
            triumphant: 'uplifting, victorious, celebratory, major key, triumphant',
            focused: config.get('styles.working') || 'lo-fi beats, focus, concentration, chill',
            ambient: 'ambient, calm, minimal, atmospheric, peaceful',
        };
        let prompt = moodPrompts[mood];
        if (intensity > 70) {
            prompt += ', fast tempo, intense, energetic';
        }
        else if (intensity > 50) {
            prompt += ', medium tempo, steady';
        }
        else if (intensity < 30) {
            prompt += ', slow tempo, gentle, soft';
        }
        prompt += ', instrumental';
        return prompt;
    }
    getCurrentMood() {
        return this.currentMood;
    }
    isCurrentlyPlaying() {
        return this.isPlaying;
    }
    // ---------- Persisted library & project theme ----------
    loadPersistedLibrary() {
        try {
            const rawLibrary = this.workspaceState.get(WORKSPACE_STATE_KEY_LIBRARY);
            this.library = Array.isArray(rawLibrary) ? rawLibrary : [];
            const rawTheme = this.workspaceState.get(WORKSPACE_STATE_KEY_PROJECT_THEME);
            this.projectTheme = rawTheme && typeof rawTheme.prompt === 'string' ? rawTheme : null;
            this.playerProvider.setLibrary(this.library);
            this.playerProvider.setProjectThemeAvailable(!!this.projectTheme);
        }
        catch (error) {
            console.error('MusicManager: loadPersistedLibrary error', error);
        }
    }
    getProjectTheme() {
        return this.projectTheme;
    }
    getLibrary() {
        return [...this.library];
    }
    setProjectTheme(track, prompt, style) {
        const persisted = {
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
    upsertRealtimeProjectTheme(prompt, weightedPrompts, generationConfig) {
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
    addToLibrary(track, options) {
        const persisted = {
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
    addRealtimePresetToLibrary(prompt, weightedPrompts, generationConfig) {
        const newest = this.library[0];
        if (newest &&
            newest.engine === 'lyria' &&
            newest.prompt === prompt &&
            Date.now() - newest.generatedAt < 120000) {
            return;
        }
        const persisted = {
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
    persistLibrary() {
        try {
            void this.workspaceState.update(WORKSPACE_STATE_KEY_LIBRARY, this.library);
        }
        catch (error) {
            console.error('MusicManager: persistLibrary error', error);
        }
    }
    async getRepositoryText() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder)
            return null;
        const parts = [];
        if (folder.name) {
            parts.push(`Instrumental theme for project ${folder.name}`);
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
        }
        catch {
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
            }
            catch {
                // ignore
            }
        }
        try {
            const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json');
            const data = await Promise.resolve(vscode.workspace.fs.readFile(pkgUri)).catch(() => null);
            if (data) {
                const json = JSON.parse(Buffer.from(data).toString('utf8'));
                if (json?.name)
                    parts.push(`Project: ${json.name}`);
                if (typeof json?.description === 'string') {
                    parts.push(json.description.substring(0, 120));
                }
            }
        }
        catch {
            // ignore
        }
        if (parts.length === 0)
            return null;
        return parts.join('. ').substring(0, PROJECT_THEME_PROMPT_MAX_CHARS);
    }
    async deriveProjectThemePrompt() {
        const combined = await this.getRepositoryText();
        if (!combined)
            return null;
        return `${combined}, instrumental`;
    }
    async getRepositoryMood() {
        const text = await this.getRepositoryText();
        if (!text || text.length < 10)
            return 'focused';
        const classification = this.classifier.classify(text);
        return classification.mood;
    }
    async ensureProjectTheme() {
        if (this.projectTheme?.prompt) {
            this.playerProvider.setProjectThemeAvailable(true);
            return;
        }
        const prompt = await this.deriveProjectThemePrompt();
        if (!prompt)
            return;
        this.projectTheme = {
            prompt,
            style: 'Workspace-derived theme',
            generatedAt: Date.now(),
            engine: this.selectPreferredEngine() === 'lyria' ? 'lyria' : 'suno',
        };
        await this.workspaceState.update(WORKSPACE_STATE_KEY_PROJECT_THEME, this.projectTheme);
        this.playerProvider.setProjectThemeAvailable(true);
        if (this.projectTheme.engine === 'suno') {
            try {
                const result = await this.generationEngine.generate(prompt, true, true);
                if (result.tracks && result.tracks.length > 0) {
                    const track = result.tracks[0];
                    this.setProjectTheme(track, prompt);
                    this.addToLibrary(track, { prompt, engine: 'suno' });
                }
            }
            catch (error) {
                console.error('MusicManager: ensureProjectTheme generation error', error);
            }
        }
    }
    async playProjectTheme() {
        if (this.isPlaying)
            return;
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
            this.playerProvider.updateState({ mood: this.currentMood });
            this.playerProvider.playTrack(theme.track.audio_url, theme.track.title ?? 'Project theme', theme.style ?? theme.prompt.substring(0, 50), theme.track.mood);
            return;
        }
        await this.startFlow(theme?.prompt);
    }
    playLibraryTrack(index) {
        const track = this.library[index];
        if (!track)
            return;
        if (this.isPlaying) {
            this.stop();
        }
        if (track.engine === 'lyria' || !track.audio_url) {
            this.currentMood = track.mood ?? this.currentMood;
            this.currentIntensity = 40;
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
        this.playerProvider.updateState({ mood: this.currentMood });
        this.playerProvider.playTrack(track.audio_url, track.title ?? 'Library track', track.style ?? track.prompt?.substring(0, 50) ?? '', track.mood);
    }
    selectPreferredEngine() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        const preference = config.get('engine') ?? 'auto';
        if (preference === 'suno') {
            return 'suno';
        }
        const hasGeminiKey = this.getGeminiApiKey().length > 0;
        if (preference === 'lyria') {
            if (!hasGeminiKey) {
                vscode.window.setStatusBarMessage('AgenticSuno: geminiApiKey missing, falling back to Suno/mock.', 3000);
                return 'suno';
            }
            return 'lyria';
        }
        return hasGeminiKey ? 'lyria' : 'suno';
    }
    getGeminiApiKey() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get('geminiApiKey') || '').trim();
    }
    getLyriaModel() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get('lyriaModel') || 'models/lyria-realtime-exp').trim();
    }
    getLyriaStyleAnchor() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        return (config.get('lyriaStyleAnchor') || '').trim();
    }
    dispose() {
        this.stop();
        this.lyriaEngine.dispose();
    }
}
exports.MusicManager = MusicManager;
//# sourceMappingURL=MusicManager.js.map