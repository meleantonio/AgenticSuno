import { LyriaClient } from '../../lyria/LyriaClient';
import {
    LyriaAudioChunk,
    LyriaGenerationConfig,
    LyriaSessionInfo,
    LyriaWeightedPrompt,
} from '../../lyria/types';

interface LyriaCallbacks {
    onStreamInit: (session: LyriaSessionInfo) => void;
    onStreamChunk: (chunk: LyriaAudioChunk) => void;
    onStreamPause: () => void;
    onStreamResume: () => void;
    onStreamStop: () => void;
    onStreamReset: () => void;
    onWarning: (message: string) => void;
    onError: (message: string, recoverable: boolean) => void;
}

/**
 * High-level Lyria control wrapper used by MusicManager.
 */
export class LyriaEngineAdapter {
    private client: LyriaClient;
    private readonly unsubscribers: Array<() => void> = [];

    private lastPrompts: LyriaWeightedPrompt[] = [];
    private lastConfig: LyriaGenerationConfig = {};
    private wantsPlayback = false;
    private hasStartedSession = false;

    constructor(
        apiKey: string,
        model: string,
        private readonly callbacks: LyriaCallbacks,
    ) {
        this.client = new LyriaClient({ apiKey, model });
        this.bindClientEvents();
    }

    public configure(apiKey: string, model: string): void {
        this.client.updateOptions({ apiKey, model });
    }

    public async startSession(prompts: LyriaWeightedPrompt[], config: LyriaGenerationConfig): Promise<void> {
        this.lastPrompts = prompts;
        this.lastConfig = config;
        this.wantsPlayback = true;

        await this.client.connect();
        await this.client.setWeightedPrompts(prompts);
        await this.client.setGenerationConfig(config);
        this.client.play();
        this.hasStartedSession = true;
        this.callbacks.onStreamResume();
    }

    public async steer(prompts: LyriaWeightedPrompt[], config: LyriaGenerationConfig): Promise<void> {
        this.lastPrompts = prompts;
        this.lastConfig = config;

        await this.client.connect();
        await this.client.setWeightedPrompts(prompts);
        await this.client.setGenerationConfig(config);
    }

    public async skip(prompts: LyriaWeightedPrompt[], config: LyriaGenerationConfig): Promise<void> {
        this.lastPrompts = prompts;
        this.lastConfig = config;

        await this.client.connect();
        this.client.resetContext();
        await this.client.setWeightedPrompts(prompts);
        await this.client.setGenerationConfig(config);
        this.client.play();
        this.callbacks.onStreamReset();
    }

    public async pause(): Promise<void> {
        this.wantsPlayback = false;
        await this.client.connect();
        this.client.pause();
        this.callbacks.onStreamPause();
    }

    public async resume(): Promise<void> {
        this.wantsPlayback = true;
        await this.client.connect();
        this.client.play();
        this.callbacks.onStreamResume();
    }

    public async stop(): Promise<void> {
        this.wantsPlayback = false;
        this.hasStartedSession = false;
        const session = this.client.getSessionInfo();
        if (session) {
            this.client.stop();
        }
        this.callbacks.onStreamStop();
    }

    public dispose(): void {
        this.wantsPlayback = false;
        for (const unsubscribe of this.unsubscribers) {
            unsubscribe();
        }
        this.unsubscribers.length = 0;
        this.client.disconnect();
    }

    private bindClientEvents(): void {
        this.unsubscribers.push(this.client.onConnected(async (session) => {
            this.callbacks.onStreamInit(session);

            // Rehydrate steering state after reconnect.
            if (this.hasStartedSession && this.lastPrompts.length > 0) {
                try {
                    await this.client.setWeightedPrompts(this.lastPrompts);
                    await this.client.setGenerationConfig(this.lastConfig);
                    if (this.wantsPlayback) {
                        this.client.play();
                        this.callbacks.onStreamResume();
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.callbacks.onError(`Failed to restore Lyria state after reconnect: ${message}`, true);
                }
            }
        }));

        this.unsubscribers.push(this.client.onAudioChunk((chunk) => {
            this.callbacks.onStreamChunk(chunk);
        }));

        this.unsubscribers.push(this.client.onWarning((warning) => {
            this.callbacks.onWarning(warning);
        }));

        this.unsubscribers.push(this.client.onFilteredPrompt((message) => {
            this.callbacks.onWarning(`Filtered prompt by server: ${message}`);
        }));

        this.unsubscribers.push(this.client.onDisconnected(({ willReconnect, code }) => {
            if (!willReconnect && code !== 1000) {
                this.callbacks.onError('Lyria session disconnected and reconnect budget was exhausted.', true);
            }
        }));

        this.unsubscribers.push(this.client.onError((error) => {
            this.callbacks.onError(error.message, true);
        }));
    }
}
