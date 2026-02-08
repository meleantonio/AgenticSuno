export type LyriaPlaybackControl = 'PLAY' | 'PAUSE' | 'STOP' | 'RESET_CONTEXT';

export interface LyriaWeightedPrompt {
    text: string;
    weight: number;
}

export interface LyriaGenerationConfig {
    temperature?: number;
    guidance?: number;
    bpm?: number;
    density?: number;
    brightness?: number;
    topK?: number;
    seed?: number;
}

export interface LyriaConnectionOptions {
    apiKey: string;
    model: string;
    maxReconnectAttempts?: number;
    reconnectBaseDelayMs?: number;
    reconnectMaxDelayMs?: number;
    setupTimeoutMs?: number;
}

export interface LyriaAudioChunk {
    sessionId: string;
    sequence: number;
    data: string; // base64 payload
    mimeType: string;
    sampleRateHz: number;
    channels: number;
    receivedAt: number;
}

export interface LyriaSessionInfo {
    sessionId: string;
    model: string;
    connectedAt: number;
}

export interface ParsedLyriaAudioPayload {
    data: string;
    mimeType: string;
    sampleRateHz: number;
    channels: number;
}

export interface ParsedLyriaServerMessage {
    setupComplete: boolean;
    audioPayloads: ParsedLyriaAudioPayload[];
    warning?: string;
    filteredPrompt?: string;
}
