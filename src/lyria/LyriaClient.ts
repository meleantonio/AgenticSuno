import WebSocket = require('ws');
import {
    LyriaAudioChunk,
    LyriaConnectionOptions,
    LyriaGenerationConfig,
    LyriaPlaybackControl,
    LyriaSessionInfo,
    LyriaWeightedPrompt,
    ParsedLyriaAudioPayload,
    ParsedLyriaServerMessage,
} from './types';

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_CHANNELS = 2;
const WS_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic';

function asObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }
    return undefined;
}

function parseAudioFormatFromMime(mimeType: string): { sampleRateHz: number; channels: number } {
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const channelsMatch = /channels=(\d+)/i.exec(mimeType);

    return {
        sampleRateHz: rateMatch ? Number(rateMatch[1]) : DEFAULT_SAMPLE_RATE,
        channels: channelsMatch ? Number(channelsMatch[1]) : DEFAULT_CHANNELS,
    };
}

function parseAudioChunk(rawChunk: unknown): ParsedLyriaAudioPayload | null {
    const chunk = asObject(rawChunk);
    if (!chunk) {
        return null;
    }

    const inlineData = asObject(chunk.inlineData ?? chunk.inline_data);
    const data = pickString(chunk.data, inlineData?.data, chunk.audioData, chunk.audio_data);
    if (!data) {
        return null;
    }

    const mimeType = pickString(
        chunk.mimeType,
        chunk.mime_type,
        inlineData?.mimeType,
        inlineData?.mime_type,
        'audio/pcm;rate=48000;channels=2',
    ) ?? 'audio/pcm;rate=48000;channels=2';

    const parsedFormat = parseAudioFormatFromMime(mimeType);

    return {
        data,
        mimeType,
        sampleRateHz: parsedFormat.sampleRateHz,
        channels: parsedFormat.channels,
    };
}

/**
 * Parse a server websocket message while tolerating snake_case and camelCase fields.
 */
export function parseLyriaServerMessage(rawMessage: unknown): ParsedLyriaServerMessage {
    const root = asObject(rawMessage) ?? {};
    const serverContent = asObject(root.serverContent ?? root.server_content);

    const audioChunks = serverContent?.audioChunks ?? serverContent?.audio_chunks;
    const parsedAudio: ParsedLyriaAudioPayload[] = [];

    if (Array.isArray(audioChunks)) {
        for (const chunk of audioChunks) {
            const parsed = parseAudioChunk(chunk);
            if (parsed) {
                parsedAudio.push(parsed);
            }
        }
    }

    const filteredPromptNode = asObject(root.filteredPrompt ?? root.filtered_prompt);

    return {
        setupComplete: root.setupComplete !== undefined || root.setup_complete !== undefined,
        audioPayloads: parsedAudio,
        warning: pickString(root.warning, root.warningMessage, root.warning_message),
        filteredPrompt: pickString(
            filteredPromptNode?.text,
            filteredPromptNode?.reason,
            root.filteredPromptReason,
            root.filtered_prompt_reason,
        ),
    };
}

function rawToText(raw: WebSocket.RawData): string {
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw instanceof Buffer) {
        return raw.toString('utf8');
    }
    if (Array.isArray(raw)) {
        return Buffer.concat(raw).toString('utf8');
    }
    if (raw instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(raw)).toString('utf8');
    }
    if (ArrayBuffer.isView(raw)) {
        return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
    }
    return String(raw);
}

interface DisconnectInfo {
    code: number;
    reason: string;
    willReconnect: boolean;
}

export class LyriaClient {
    private ws: WebSocket | undefined;
    private sessionInfo: LyriaSessionInfo | undefined;
    private sequence = 0;
    private reconnectAttempt = 0;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private connectPromise: Promise<LyriaSessionInfo> | undefined;
    private manualDisconnect = false;

    private options: Required<LyriaConnectionOptions>;

    private readonly connectedListeners = new Set<(session: LyriaSessionInfo) => void>();
    private readonly disconnectedListeners = new Set<(info: DisconnectInfo) => void>();
    private readonly chunkListeners = new Set<(chunk: LyriaAudioChunk) => void>();
    private readonly warningListeners = new Set<(warning: string) => void>();
    private readonly filteredPromptListeners = new Set<(message: string) => void>();
    private readonly errorListeners = new Set<(error: Error) => void>();

    constructor(options: LyriaConnectionOptions) {
        this.options = {
            ...options,
            maxReconnectAttempts: options.maxReconnectAttempts ?? 4,
            reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 800,
            reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 10000,
            setupTimeoutMs: options.setupTimeoutMs ?? 10000,
        };
    }

    public updateOptions(next: Pick<LyriaConnectionOptions, 'apiKey' | 'model'>): void {
        this.options = {
            ...this.options,
            apiKey: next.apiKey,
            model: next.model,
        };
    }

    public onConnected(listener: (session: LyriaSessionInfo) => void): () => void {
        this.connectedListeners.add(listener);
        return () => this.connectedListeners.delete(listener);
    }

    public onDisconnected(listener: (info: DisconnectInfo) => void): () => void {
        this.disconnectedListeners.add(listener);
        return () => this.disconnectedListeners.delete(listener);
    }

    public onAudioChunk(listener: (chunk: LyriaAudioChunk) => void): () => void {
        this.chunkListeners.add(listener);
        return () => this.chunkListeners.delete(listener);
    }

    public onWarning(listener: (warning: string) => void): () => void {
        this.warningListeners.add(listener);
        return () => this.warningListeners.delete(listener);
    }

    public onFilteredPrompt(listener: (message: string) => void): () => void {
        this.filteredPromptListeners.add(listener);
        return () => this.filteredPromptListeners.delete(listener);
    }

    public onError(listener: (error: Error) => void): () => void {
        this.errorListeners.add(listener);
        return () => this.errorListeners.delete(listener);
    }

    public getSessionInfo(): LyriaSessionInfo | undefined {
        return this.sessionInfo;
    }

    public async connect(): Promise<LyriaSessionInfo> {
        if (!this.options.apiKey) {
            throw new Error('Gemini API key is missing. Set agenticSuno.geminiApiKey to use Lyria realtime.');
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionInfo) {
            return this.sessionInfo;
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.manualDisconnect = false;
        this.connectPromise = this.openConnection();

        try {
            const session = await this.connectPromise;
            return session;
        } finally {
            this.connectPromise = undefined;
        }
    }

    public disconnect(): void {
        this.manualDisconnect = true;
        this.clearReconnectTimer();

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.ws.close(1000, 'Client disconnect');
        }

        this.ws = undefined;
        this.sessionInfo = undefined;
    }

    public async setWeightedPrompts(prompts: LyriaWeightedPrompt[]): Promise<void> {
        const normalized = prompts
            .filter((p) => typeof p.text === 'string' && p.text.trim().length > 0)
            .map((p) => ({ text: p.text.trim().substring(0, 240), weight: Number(p.weight.toFixed(2)) }));

        if (normalized.length === 0) {
            throw new Error('Lyria requires at least one weighted prompt.');
        }

        this.send({
            clientContent: {
                weightedPrompts: normalized,
            },
        });
    }

    public async setGenerationConfig(config: LyriaGenerationConfig): Promise<void> {
        const payload: Record<string, number> = {};

        if (typeof config.temperature === 'number') payload.temperature = config.temperature;
        if (typeof config.guidance === 'number') payload.guidance = config.guidance;
        if (typeof config.bpm === 'number') payload.bpm = config.bpm;
        if (typeof config.density === 'number') payload.density = config.density;
        if (typeof config.brightness === 'number') payload.brightness = config.brightness;
        if (typeof config.topK === 'number') payload.topK = config.topK;
        if (typeof config.seed === 'number') payload.seed = config.seed;

        if (Object.keys(payload).length === 0) {
            return;
        }

        this.send({
            musicGenerationConfig: payload,
        });
    }

    public play(): void {
        this.sendPlaybackControl('PLAY');
    }

    public pause(): void {
        this.sendPlaybackControl('PAUSE');
    }

    public stop(): void {
        this.sendPlaybackControl('STOP');
    }

    public resetContext(): void {
        this.sendPlaybackControl('RESET_CONTEXT');
    }

    private sendPlaybackControl(control: LyriaPlaybackControl): void {
        this.send({
            playbackControl: control,
        });
    }

    private emitError(error: Error): void {
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }

    private emitParsedServerMessage(parsed: ParsedLyriaServerMessage): void {
        if (parsed.warning) {
            for (const listener of this.warningListeners) {
                listener(parsed.warning);
            }
        }

        if (parsed.filteredPrompt) {
            for (const listener of this.filteredPromptListeners) {
                listener(parsed.filteredPrompt);
            }
        }

        if (!this.sessionInfo) {
            return;
        }

        for (const payload of parsed.audioPayloads) {
            this.sequence += 1;
            const chunk: LyriaAudioChunk = {
                sessionId: this.sessionInfo.sessionId,
                sequence: this.sequence,
                data: payload.data,
                mimeType: payload.mimeType,
                sampleRateHz: payload.sampleRateHz,
                channels: payload.channels,
                receivedAt: Date.now(),
            };

            for (const listener of this.chunkListeners) {
                listener(chunk);
            }
        }
    }

    private async openConnection(): Promise<LyriaSessionInfo> {
        return new Promise<LyriaSessionInfo>((resolve, reject) => {
            const sessionId = `lyria-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
            this.sequence = 0;

            const socket = new WebSocket(`${WS_ENDPOINT}?key=${encodeURIComponent(this.options.apiKey)}`);
            this.ws = socket;

            let settled = false;

            const setupTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('Timed out waiting for Lyria setupComplete handshake.'));
                try {
                    socket.close(1013, 'setup timeout');
                } catch {
                    // no-op
                }
            }, this.options.setupTimeoutMs);

            const clearSetupTimeout = () => {
                clearTimeout(setupTimeout);
            };

            socket.on('open', () => {
                this.sendRaw(socket, {
                    setup: {
                        model: this.options.model,
                    },
                });
            });

            socket.on('message', (raw: WebSocket.RawData) => {
                let parsed: ParsedLyriaServerMessage | null = null;
                try {
                    const asText = rawToText(raw);
                    const json = JSON.parse(asText) as unknown;
                    parsed = parseLyriaServerMessage(json);
                } catch (error) {
                    this.emitError(new Error(`Failed to parse Lyria message: ${String(error)}`));
                    return;
                }

                if (!parsed) {
                    return;
                }

                if (parsed.setupComplete && !settled) {
                    settled = true;
                    clearSetupTimeout();
                    this.reconnectAttempt = 0;
                    this.sessionInfo = {
                        sessionId,
                        model: this.options.model,
                        connectedAt: Date.now(),
                    };
                    for (const listener of this.connectedListeners) {
                        listener(this.sessionInfo);
                    }
                    resolve(this.sessionInfo);
                }

                this.emitParsedServerMessage(parsed);
            });

            socket.on('error', (error) => {
                const asError = error instanceof Error ? error : new Error(String(error));
                this.emitError(asError);
                if (!settled) {
                    settled = true;
                    clearSetupTimeout();
                    reject(asError);
                }
            });

            socket.on('close', (code, reasonBuffer) => {
                const reason = reasonBuffer.toString();
                const shouldReconnect = !this.manualDisconnect && code !== 1000;

                this.ws = undefined;
                this.sessionInfo = undefined;

                if (!settled && !this.manualDisconnect) {
                    settled = true;
                    clearSetupTimeout();
                    reject(new Error(`Lyria socket closed before setupComplete (code ${code}: ${reason || 'no reason'})`));
                }

                for (const listener of this.disconnectedListeners) {
                    listener({ code, reason, willReconnect: shouldReconnect && this.reconnectAttempt < this.options.maxReconnectAttempts });
                }

                if (shouldReconnect) {
                    this.scheduleReconnect();
                }
            });
        });
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempt >= this.options.maxReconnectAttempts) {
            this.emitError(new Error('Lyria reconnect limit reached. Falling back is recommended.'));
            return;
        }

        this.clearReconnectTimer();

        const exponential = this.options.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempt);
        const delay = Math.min(exponential, this.options.reconnectMaxDelayMs) + Math.floor(Math.random() * 300);

        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch((error) => {
                const asError = error instanceof Error ? error : new Error(String(error));
                this.emitError(asError);
                this.scheduleReconnect();
            });
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private send(payload: Record<string, unknown>): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Lyria websocket is not connected.');
        }
        this.sendRaw(this.ws, payload);
    }

    private sendRaw(socket: WebSocket, payload: Record<string, unknown>): void {
        socket.send(JSON.stringify(payload));
    }
}

export { parseAudioFormatFromMime };
