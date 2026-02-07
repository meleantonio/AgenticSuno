import axios from 'axios';
import * as vscode from 'vscode';

// Response from generate/extend endpoints
interface GenerateResponse {
    code: number;
    msg: string;
    data: {
        taskId: string;
    };
}

// Response from record-info endpoint
interface RecordInfoResponse {
    code: number;
    msg: string;
    data: {
        taskId: string;
        status: 'PENDING' | 'TEXT_SUCCESS' | 'FIRST_SUCCESS' | 'SUCCESS' | 'CREATE_TASK_FAILED' | 'GENERATE_AUDIO_FAILED' | 'CALLBACK_EXCEPTION' | 'SENSITIVE_WORD_ERROR';
        response?: {
            taskId: string;
            sunoData: SunoTrack[];
        };
        errorMessage?: string;
    };
}

interface SunoTrack {
    id: string;
    audioUrl: string;
    streamAudioUrl?: string;
    imageUrl?: string;
    prompt?: string;
    modelName?: string;
    title?: string;
    tags?: string;
    createTime?: string;
    duration?: number;
}

// Our normalized track interface
export interface MusicTrack {
    id: string;
    audio_url: string;
    title?: string;
    status: 'submitted' | 'processing' | 'complete' | 'error';
    duration?: number;
    metadata?: any;
}

// Generation timing metrics
export interface GenerationMetrics {
    requestStartTime: number;
    completionTime: number;
    elapsedMs: number;
    pollAttempts: number;
}

// Result from generate/extend including timing
export interface GenerateResult {
    tracks: MusicTrack[];
    metrics: GenerationMetrics;
}

export class SunoClient {
    // Correct API base URL from docs.sunoapi.org
    private baseUrl: string = 'https://api.sunoapi.org/api/v1';
    private apiKey: string = '';
    private useMock: boolean = true;
    private pollIntervalMs: number = 2000;  // Poll every 2 seconds (reduced for faster response)
    private maxPollAttempts: number = 150;  // Max 5 minutes of polling (150 * 2s = 300s)

    constructor() {
        this.updateConfiguration();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agenticSuno')) {
                this.updateConfiguration();
            }
        });
    }

    private updateConfiguration() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        this.apiKey = config.get<string>('apiKey') || '';
        this.useMock = config.get<boolean>('useMock') ?? true;
    }

    private getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Retry a function with exponential backoff for transient errors (5xx)
     */
    private async retryWithBackoff<T>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        initialDelayMs: number = 1000
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;
                const status = error?.response?.status;
                const isRetryable = status && status >= 500 && status < 600;

                if (!isRetryable || attempt === maxRetries) {
                    throw error;
                }

                const delay = initialDelayMs * Math.pow(2, attempt);
                console.log(`SunoClient: Retry ${attempt + 1}/${maxRetries} after ${delay}ms (status: ${status})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Poll for task completion with timing metrics
     */
    private async pollForCompletion(taskId: string, startTime: number): Promise<{ tracks: MusicTrack[], pollAttempts: number }> {
        console.log(`SunoClient: Polling for task ${taskId}`);

        for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
            try {
                const response = await axios.get<RecordInfoResponse>(
                    `${this.baseUrl}/generate/record-info`,
                    {
                        params: { taskId },
                        headers: this.getHeaders()
                    }
                );

                const data = response.data;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`SunoClient: Poll attempt ${attempt + 1}, status: ${data.data.status}, elapsed: ${elapsed}s`);

                // Return as soon as we have playable tracks: FIRST_SUCCESS (first track ready for streaming) or SUCCESS (all done)
                if (data.data.status === 'SUCCESS' || data.data.status === 'FIRST_SUCCESS') {
                    const tracks = data.data.response?.sunoData || [];
                    if (tracks.length > 0) {
                        if (data.data.status === 'FIRST_SUCCESS') {
                            console.log(`SunoClient: First track(s) ready at FIRST_SUCCESS - returning ${tracks.length} track(s) for immediate playback`);
                        }
                        return { tracks: tracks.map(t => this.normalizeTrack(t)), pollAttempts: attempt + 1 };
                    }
                    // FIRST_SUCCESS with empty sunoData - keep polling until we have tracks or SUCCESS
                    if (data.data.status === 'SUCCESS') {
                        return { tracks: [], pollAttempts: attempt + 1 };
                    }
                }

                if (data.data.status.includes('FAILED') || data.data.status.includes('ERROR')) {
                    throw new Error(`Generation failed: ${data.data.errorMessage || data.data.status}`);
                }

                // Still processing, wait and retry
                await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));

            } catch (error: any) {
                console.error('SunoClient: Poll error:', error.message);
                throw error;
            }
        }

        throw new Error('Polling timeout - generation took too long');
    }

    /**
     * Normalize SunoTrack to our MusicTrack interface.
     * Prefer streamAudioUrl when present so playback can start immediately (e.g. at FIRST_SUCCESS).
     */
    private normalizeTrack(track: SunoTrack): MusicTrack {
        return {
            id: track.id,
            audio_url: track.streamAudioUrl || track.audioUrl,
            title: track.title,
            status: 'complete',
            duration: track.duration,
            metadata: { tags: track.tags, imageUrl: track.imageUrl }
        };
    }

    async generate(prompt: string, instrumental: boolean = true, silent: boolean = false): Promise<GenerateResult> {
        const startTime = Date.now();
        console.log(`SunoClient: generate called. useMock=${this.useMock}, hasApiKey=${!!this.apiKey}, silent=${silent}`);

        if (this.useMock) {
            console.log('SunoClient: Generating Mock Data (Explicit)');
            const tracks = await this.getMockData(prompt);
            return this.createResult(tracks, startTime, 0);
        }

        if (!this.apiKey) {
            console.warn('Suno API Key is missing. Falling back to Mock Data.');
            const tracks = await this.getMockData(prompt);
            return this.createResult(tracks, startTime, 0);
        }

        try {
            console.log(`SunoClient: Sending request to ${this.baseUrl}/generate`);

            // Use non-custom mode for simplicity - just provide prompt
            const response = await this.retryWithBackoff(() =>
                axios.post<GenerateResponse>(`${this.baseUrl}/generate`, {
                    customMode: false,
                    instrumental: instrumental,
                    prompt: prompt.substring(0, 500), // Max 500 chars for non-custom mode
                    model: 'V5',
                    callBackUrl: 'https://localhost/callback' // Required by API, we use polling
                }, { headers: this.getHeaders() })
            );

            if (response.data.code !== 200) {
                throw new Error(`API error: ${response.data.msg}`);
            }

            const taskId = response.data.data.taskId;
            console.log(`SunoClient: Task created: ${taskId}`);

            // Poll for completion
            const { tracks, pollAttempts } = await this.pollForCompletion(taskId, startTime);
            return this.createResult(tracks, startTime, pollAttempts);

        } catch (error: any) {
            console.error('SunoClient Generate Error:', error);
            if (!silent) {
                console.log('SunoClient: API Failed. Falling back to Mock Data.');
                vscode.window.showWarningMessage('AgenticSuno: API failed/unavailable. Using Mock Data.');
            }
            const tracks = await this.getMockData(prompt);
            return this.createResult(tracks, startTime, 0);
        }
    }

    async extend(audioId: string, prompt: string, continueAt?: number): Promise<GenerateResult> {
        const startTime = Date.now();
        console.log(`SunoClient: extend called. useMock=${this.useMock}, hasApiKey=${!!this.apiKey}`);

        if (this.useMock) {
            console.log('SunoClient: Extending Mock Data');
            const tracks = await this.getMockData(prompt, true);
            return this.createResult(tracks, startTime, 0);
        }

        if (!this.apiKey) {
            console.warn('Suno API Key is missing. Falling back to Mock Data.');
            const tracks = await this.getMockData(prompt, true);
            return this.createResult(tracks, startTime, 0);
        }

        try {
            console.log(`SunoClient: Sending extend request to ${this.baseUrl}/generate/extend`);

            const response = await this.retryWithBackoff(() =>
                axios.post<GenerateResponse>(`${this.baseUrl}/generate/extend`, {
                    audioId: audioId,
                    prompt: prompt.substring(0, 500),
                    continueAt: continueAt || 60,
                    defaultParamFlag: true,
                    model: 'V5',
                    callBackUrl: 'https://localhost/callback' // Required by API, we use polling
                }, { headers: this.getHeaders() })
            );

            if (response.data.code !== 200) {
                throw new Error(`API error: ${response.data.msg}`);
            }

            const taskId = response.data.data.taskId;
            console.log(`SunoClient: Extend task created: ${taskId}`);

            // Poll for completion
            const { tracks, pollAttempts } = await this.pollForCompletion(taskId, startTime);
            return this.createResult(tracks, startTime, pollAttempts);

        } catch (error: any) {
            console.error('SunoClient Extend Error:', error);
            console.log('SunoClient: Extend API Failed. Falling back to Mock Data.');
            vscode.window.showWarningMessage('AgenticSuno: Extend API failed. Using Mock Data.');
            const tracks = await this.getMockData(prompt, true);
            return this.createResult(tracks, startTime, 0);
        }
    }

    /**
     * Create a GenerateResult with timing metrics
     */
    private createResult(tracks: MusicTrack[], startTime: number, pollAttempts: number): GenerateResult {
        const completionTime = Date.now();
        const elapsedMs = completionTime - startTime;
        console.log(`SunoClient: Generation complete in ${(elapsedMs / 1000).toFixed(1)}s (${pollAttempts} polls)`);
        return {
            tracks,
            metrics: {
                requestStartTime: startTime,
                completionTime,
                elapsedMs,
                pollAttempts
            }
        };
    }

    async getStatus(taskIds: string[]): Promise<MusicTrack[]> {
        if (this.useMock) {
            return [];
        }

        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }

        const allTracks: MusicTrack[] = [];

        for (const taskId of taskIds) {
            try {
                const response = await axios.get<RecordInfoResponse>(
                    `${this.baseUrl}/generate/record-info`,
                    {
                        params: { taskId },
                        headers: this.getHeaders()
                    }
                );

                if (response.data.data.response?.sunoData) {
                    const tracks = response.data.data.response.sunoData.map(t => this.normalizeTrack(t));
                    allTracks.push(...tracks);
                }
            } catch (error: any) {
                console.error(`SunoClient Status Error for ${taskId}:`, error);
            }
        }

        return allTracks;
    }

    private async getMockData(prompt: string, isExtension: boolean = false): Promise<MusicTrack[]> {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate latency

        const demoTracks = [
            'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
            'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
            'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
        ];
        const randomTrack = demoTracks[Math.floor(Math.random() * demoTracks.length)];

        return [{
            id: `mock-${Date.now()}`,
            audio_url: randomTrack,
            title: isExtension ? `Extension: ${prompt.substring(0, 15)}...` : `Generated: ${prompt.substring(0, 15)}...`,
            status: 'complete',
            duration: 120,
            metadata: { tags: prompt }
        }];
    }
}
