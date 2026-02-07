// AgenticSuno Type Definitions

// ========== Agent Activity ==========

export type AgentType = 'antigravity' | 'gemini' | 'cursor' | 'claude' | 'copilot' | 'unknown';
export type ActivitySource = 'output_channel' | 'terminal' | 'file_system';
export type Mood = 'epic' | 'focused' | 'tense' | 'triumphant' | 'ambient';
export type TaskPhase = 'planning' | 'execution' | 'verification' | 'idle';
export type MusicStatus = 'idle' | 'generating' | 'playing' | 'paused' | 'error';

export interface AgentActivity {
    id: string;
    agentType: AgentType;
    source: ActivitySource;
    timestamp: number;
    rawText: string;
    classification: ActivityClassification;
}

export interface ActivityClassification {
    mood: Mood;
    intensity: number;  // 0-100
    taskPhase: TaskPhase;
    signals: string[];  // Keywords that triggered classification
}

// ========== Legacy Support ==========
// Keeping compatibility with existing AgentState interface
export interface AgentState {
    source: AgentType;
    status: 'idle' | 'working' | 'error' | 'success';
    intensity: number; // 1-10
    currentTask?: string;
    mood?: Mood;
}

// ========== Music State ==========

export interface MusicState {
    status: MusicStatus;
    currentClip: AudioClip | null;
    queue: AudioClip[];
    projectTheme: ProjectTheme | null;
    volume: number;  // 0-1
    muted: boolean;
    mood: Mood;
    intensity: number;
    activeAgents: number;
}

export interface AudioClip {
    id: string;
    sunoAudioId: string;
    url: string;
    duration: number;  // seconds
    mood: Mood;
    intensity: number;
    generatedAt: number;
    isExtension: boolean;
    parentClipId?: string;
    title?: string;
}

export interface ProjectTheme {
    name: string;
    prompt: string;  // Base prompt for Suno
    style: string;   // Musical style descriptor
    generatedFrom: string;  // Source (README, package.json, etc.)
}

// ========== Persisted library (workspaceState) ==========

/** One track stored in the song library for replay across sessions */
export interface PersistedTrack {
    id: string;
    audio_url: string;
    title?: string;
    mood?: Mood;
    generatedAt: number;
    prompt?: string;
    style?: string;
}

/** Project theme (first song) stored in workspaceState */
export interface StoredProjectTheme {
    track?: PersistedTrack;
    prompt: string;
    style?: string;
    generatedAt?: number;
}

// ========== Suno API ==========

export interface SunoGenerateRequest {
    prompt: string;
    style: string;
    model: 'v4' | 'v4.5' | 'v5';
    duration?: number;  // 30-240 seconds
    instrumental?: boolean;
}

export interface SunoExtendRequest {
    audioId: string;
    continueAt?: number;  // seconds
    prompt?: string;
    style?: string;
    model: 'v4' | 'v4.5' | 'v5';
}

export interface SunoTaskResponse {
    taskId: string;
    status: 'pending' | 'processing' | 'complete' | 'failed';
    audioId?: string;
    audioUrl?: string;
    duration?: number;
}

// ========== Configuration ==========

export interface ExtensionConfig {
    sunoApiKey: string;
    autoPlayOnActivity: boolean;
    monitoredChannels: string[];  // Regex patterns
    preferredStyle: string;
    intensitySensitivity: number;  // 0.5 - 2.0 multiplier
    mockMode: boolean;
    volume: number;
}

// ========== Events ==========

export interface TimeUpdateEvent {
    currentTime: number;
    duration: number;
    remainingTime: number;
}

export interface WebviewMessage {
    type: 'play' | 'pause' | 'stop' | 'setVolume' | 'timeUpdate' | 'ended' | 'log' | 'error' | 'updateState';
    [key: string]: any;
}
