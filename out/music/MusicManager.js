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
const SunoClient_1 = require("../suno/SunoClient");
const MoodClassifier_1 = require("../classification/MoodClassifier");
const WORKSPACE_STATE_KEY_LIBRARY = 'agenticSuno.library';
const WORKSPACE_STATE_KEY_PROJECT_THEME = 'agenticSuno.projectTheme';
const LIBRARY_MAX_TRACKS = 50;
const PROJECT_THEME_PROMPT_MAX_CHARS = 400;
/**
 * MusicManager - Enhanced orchestrator for music generation and playback.
 * Coordinates between activity detection, mood classification, and audio playback.
 */
class MusicManager {
    playerProvider;
    workspaceState;
    client;
    classifier;
    queue = [];
    currentTrack;
    state = { source: 'antigravity', status: 'idle', intensity: 1 };
    isPlaying = false;
    currentMood = 'ambient';
    currentIntensity = 30;
    extensionTimer;
    // Track remaining time for extension scheduling
    remainingTime = 0;
    EXTENSION_THRESHOLD = 15; // seconds
    // Track generation timing
    generationStartTime = 0;
    generationIntervalId;
    // Debounce extend-on-activity to avoid too many concurrent extensions
    lastExtendOnActivityTime = 0;
    EXTEND_ON_ACTIVITY_DEBOUNCE_MS = 12000;
    // Background music cache
    moodCache = new Map();
    pendingGenerations = new Map();
    // Persisted library and project theme (per-workspace)
    library = [];
    projectTheme = null;
    constructor(playerProvider, workspaceState) {
        this.playerProvider = playerProvider;
        this.workspaceState = workspaceState;
        this.client = new SunoClient_1.SunoClient();
        this.classifier = new MoodClassifier_1.MoodClassifier();
        console.log('MusicManager: Initialized');
        // Start background caching for common moods
        this.initializeCache();
    }
    async initializeCache() {
        // Give extension a moment to start up before hitting API
        setTimeout(() => {
            console.log('MusicManager: Initializing background cache...');
            // Cache most likely moods first
            this.generateInBackground('focused');
            this.generateInBackground('ambient');
        }, 3000);
    }
    async generateInBackground(mood) {
        if (this.pendingGenerations.has(mood))
            return;
        // Don't cache if we already have tracks
        const cached = this.moodCache.get(mood) || [];
        if (cached.length > 0)
            return;
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
            }
            catch (error) {
                console.error(`MusicManager: Failed to cache for ${mood}`, error);
            }
            finally {
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
    handleActivity(activity) {
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
        const legacyState = {
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
    async handleStateChange(newState) {
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
    shouldUpdateMusic(newState) {
        return newState.status !== this.state.status || newState.intensity !== this.state.intensity;
    }
    /**
     * Start music as soon as the user sends a message (first activity).
     * Uses the activity content to set mood and optional prompt hints.
     */
    async startFlowFromActivity(activity) {
        if (this.isPlaying)
            return;
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
    async startFlow(customPromptHint) {
        if (this.isPlaying)
            return;
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
                }
                catch (e) {
                    console.error('MusicManager: Error waiting for background generation', e);
                }
            }
            if (cachedTracks && cachedTracks.length > 0) {
                console.log(`MusicManager: Cache HIT for ${this.currentMood}`);
                const track = cachedTracks.shift();
                this.moodCache.set(this.currentMood, cachedTracks); // Update cache
                if (track) {
                    this.queue.push(track);
                    this.addToLibrary(track, { prompt, style: this.getPromptForMood(this.currentMood, this.currentIntensity) });
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
                for (const t of result.tracks) {
                    this.addToLibrary(t, { prompt: finalPrompt, style: this.getPromptForMood(this.currentMood, this.currentIntensity) });
                }
                this.queue.push(...result.tracks);
                this.playNext();
                this.startExtensionScheduler();
            }
        }
        catch (error) {
            console.error('MusicManager: Generation error:', error);
            this.stopGenerationTimer();
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate music.');
            this.isPlaying = false;
        }
    }
    stop() {
        this.isPlaying = false;
        this.queue = [];
        this.currentTrack = undefined;
        this.stopExtensionScheduler();
        this.playerProvider.stop();
    }
    pause() {
        this.playerProvider.pause();
    }
    resume() {
        this.playerProvider.resume();
    }
    async skip() {
        if (this.queue.length > 0) {
            this.playNext();
        }
        else {
            // Generate new track
            await this.extendFlow();
        }
    }
    updateTimeRemaining(currentTime, duration, remaining) {
        this.remainingTime = remaining;
    }
    async playNext() {
        if (this.queue.length === 0)
            return;
        this.currentTrack = this.queue.shift();
        if (this.currentTrack) {
            console.log(`MusicManager: Playing track ${this.currentTrack.title || this.currentTrack.id}`);
            this.playerProvider.playTrack(this.currentTrack.audio_url, this.currentTrack.title || 'Generated Track', this.currentTrack.metadata?.tags || this.getPromptForMood(this.currentMood, this.currentIntensity), this.currentMood);
        }
        // Prefetch next track if queue is getting low
        if (this.queue.length < 2) {
            this.extendFlow();
        }
    }
    startExtensionScheduler() {
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
    stopExtensionScheduler() {
        if (this.extensionTimer) {
            clearInterval(this.extensionTimer);
            this.extensionTimer = undefined;
        }
    }
    async extendFlow() {
        if (!this.currentTrack)
            return;
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
                const style = this.getPromptForMood(this.currentMood, this.currentIntensity);
                for (const t of result.tracks) {
                    this.addToLibrary(t, { prompt: prompt, style });
                }
                this.queue.push(...result.tracks);
            }
        }
        catch (error) {
            console.error('MusicManager: Extension error:', error);
            this.stopGenerationTimer();
            // Fall back to generating new track
            try {
                const result = await this.client.generate(this.getPromptForMood(this.currentMood, this.currentIntensity));
                if (result.tracks && result.tracks.length > 0) {
                    this.queue.push(...result.tracks);
                }
            }
            catch (e) {
                console.error('MusicManager: Fallback generation also failed:', e);
            }
        }
    }
    /**
     * Start the generation timer in the UI
     */
    startGenerationTimer() {
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
    stopGenerationTimer() {
        if (this.generationIntervalId) {
            clearInterval(this.generationIntervalId);
            this.generationIntervalId = undefined;
        }
    }
    /**
     * Display generation metrics to user
     */
    showGenerationMetrics(metrics) {
        const seconds = (metrics.elapsedMs / 1000).toFixed(1);
        console.log(`MusicManager: Generation took ${seconds}s (${metrics.pollAttempts} poll attempts)`);
        vscode.window.showInformationMessage(`AgenticSuno: Music ready in ${seconds}s`);
        this.playerProvider.showGenerationComplete(parseFloat(seconds));
    }
    /**
     * Blend optional content hint (e.g. from chat) into the mood prompt for more relevant music.
     */
    blendContentHint(basePrompt, contentHint) {
        if (!contentHint || contentHint.length < 5)
            return basePrompt;
        // Take a short, sanitized slice to avoid API limits and noise
        const sanitized = contentHint.replace(/\s+/g, ' ').trim().substring(0, 80);
        if (sanitized.length < 5)
            return basePrompt;
        return `${basePrompt}, inspired by: ${sanitized}`;
    }
    /**
     * Generate prompt based on mood and intensity
     */
    getPromptForMood(mood, intensity) {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        // Base prompts by mood
        const moodPrompts = {
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
        }
        else if (intensity > 50) {
            prompt += ', medium tempo, steady';
        }
        else if (intensity < 30) {
            prompt += ', slow tempo, gentle, soft';
        }
        // Add instrumental flag
        prompt += ', instrumental';
        return prompt;
    }
    /**
     * Legacy method for getting prompt based on AgentState
     */
    getPromptForState(state) {
        const mood = state.mood || 'focused';
        const intensity = (state.intensity || 5) * 10;
        return this.getPromptForMood(mood, intensity);
    }
    getCurrentMood() {
        return this.currentMood;
    }
    isCurrentlyPlaying() {
        return this.isPlaying;
    }
    // ---------- Persisted library & project theme ----------
    /**
     * Load library and project theme from workspace state. Call once on activate.
     */
    loadPersistedLibrary() {
        try {
            const rawLibrary = this.workspaceState.get(WORKSPACE_STATE_KEY_LIBRARY);
            this.library = Array.isArray(rawLibrary) ? rawLibrary : [];
            const rawTheme = this.workspaceState.get(WORKSPACE_STATE_KEY_PROJECT_THEME);
            this.projectTheme = rawTheme && typeof rawTheme.prompt === 'string' ? rawTheme : null;
            console.log(`MusicManager: Loaded ${this.library.length} library tracks, projectTheme=${!!this.projectTheme}`);
            this.playerProvider.setLibrary(this.library);
            this.playerProvider.setProjectThemeAvailable(!!this.projectTheme);
        }
        catch (e) {
            console.error('MusicManager: loadPersistedLibrary error', e);
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
        };
        this.projectTheme = { track: persisted, prompt, style, generatedAt: persisted.generatedAt };
        this.workspaceState.update(WORKSPACE_STATE_KEY_PROJECT_THEME, this.projectTheme);
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
            this.workspaceState.update(WORKSPACE_STATE_KEY_LIBRARY, this.library);
        }
        catch (e) {
            console.error('MusicManager: persistLibrary error', e);
        }
    }
    /**
     * Derive a project-theme prompt from repo name, README, spec/, package.json.
     */
    async deriveProjectThemePrompt() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder)
            return null;
        const parts = [];
        const repoName = folder.name;
        if (repoName) {
            parts.push(`Instrumental theme for a project named ${repoName}, ambient, modern`);
        }
        try {
            const readmeUri = vscode.Uri.joinPath(folder.uri, 'README.md');
            const readmeData = await Promise.resolve(vscode.workspace.fs.readFile(readmeUri)).catch(() => null);
            if (readmeData) {
                const text = Buffer.from(readmeData).toString('utf8')
                    .replace(/#+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 300);
                if (text.length > 20)
                    parts.push(text);
            }
        }
        catch { /* ignore */ }
        const specFiles = ['spec/intent.md', 'spec/requirements.md', 'spec/design.md'];
        for (const rel of specFiles) {
            try {
                const uri = vscode.Uri.joinPath(folder.uri, rel);
                const data = await Promise.resolve(vscode.workspace.fs.readFile(uri)).catch(() => null);
                if (data) {
                    const text = Buffer.from(data).toString('utf8')
                        .replace(/#+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .substring(0, 200);
                    if (text.length > 15)
                        parts.push(text);
                    break; // one spec file is enough
                }
            }
            catch { /* ignore */ }
        }
        try {
            const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json');
            const data = await Promise.resolve(vscode.workspace.fs.readFile(pkgUri)).catch(() => null);
            if (data) {
                const json = JSON.parse(Buffer.from(data).toString('utf8'));
                const name = json?.name;
                const desc = json?.description;
                if (name)
                    parts.push(`Project: ${name}`);
                if (desc && typeof desc === 'string')
                    parts.push(desc.substring(0, 120));
            }
        }
        catch { /* ignore */ }
        if (parts.length === 0)
            return null;
        const combined = parts.join('. ').substring(0, PROJECT_THEME_PROMPT_MAX_CHARS);
        return combined + ', instrumental';
    }
    /**
     * Ensure project theme exists (lazy). Call when user opens player or first Play. No-op if no workspace or no prompt.
     */
    async ensureProjectTheme() {
        if (this.projectTheme?.track)
            return; // already have a theme track
        const prompt = this.projectTheme?.prompt ?? await this.deriveProjectThemePrompt();
        if (!prompt) {
            console.log('MusicManager: No project theme prompt (no workspace or no content)');
            return;
        }
        try {
            console.log('MusicManager: Generating project theme...');
            this.playerProvider.showGenerating(0);
            const result = await this.client.generate(prompt, true, true);
            if (result.tracks && result.tracks.length > 0) {
                const track = result.tracks[0];
                this.setProjectTheme(track, prompt);
                this.addToLibrary(track, { prompt });
                this.playerProvider.setLibrary(this.library);
            }
        }
        catch (e) {
            console.error('MusicManager: ensureProjectTheme error', e);
        }
    }
    /**
     * Play project theme (stored track or regenerate from prompt). Falls back to starting normal flow if no theme.
     */
    async playProjectTheme() {
        if (this.isPlaying)
            return;
        const theme = this.projectTheme;
        if (theme?.track?.audio_url) {
            this.isPlaying = true;
            this.currentMood = theme.track.mood ?? 'ambient';
            this.playerProvider.updateState({ mood: this.currentMood });
            this.playerProvider.playTrack(theme.track.audio_url, theme.track.title ?? 'Project theme', theme.style ?? theme.prompt.substring(0, 50), theme.track.mood);
            return;
        }
        if (theme?.prompt) {
            await this.ensureProjectTheme();
            if (this.projectTheme?.track) {
                await this.playProjectTheme();
                return;
            }
        }
        // No theme: start normal flow (will use mock if no API key)
        await this.startFlow();
    }
    /**
     * Play a track from the library by index.
     */
    playLibraryTrack(index) {
        const track = this.library[index];
        if (!track)
            return;
        if (this.isPlaying)
            this.stop();
        this.isPlaying = true;
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
}
exports.MusicManager = MusicManager;
//# sourceMappingURL=MusicManager.js.map