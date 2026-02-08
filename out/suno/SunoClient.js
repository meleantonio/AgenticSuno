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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SunoClient = void 0;
const axios_1 = __importDefault(require("axios"));
const vscode = __importStar(require("vscode"));
class SunoClient {
    // Correct API base URL from docs.sunoapi.org
    baseUrl = 'https://api.sunoapi.org/api/v1';
    apiKey = '';
    useMock = true;
    pollIntervalMs = 2000; // Poll every 2 seconds (reduced for faster response)
    maxPollAttempts = 150; // Max 5 minutes of polling (150 * 2s = 300s)
    constructor() {
        this.updateConfiguration();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agenticSuno')) {
                this.updateConfiguration();
            }
        });
    }
    updateConfiguration() {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        this.apiKey = config.get('apiKey') || '';
        this.useMock = config.get('useMock') ?? true;
    }
    getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }
    /**
     * Retry a function with exponential backoff for transient errors (5xx)
     */
    async retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
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
    async pollForCompletion(taskId, startTime) {
        console.log(`SunoClient: Polling for task ${taskId}`);
        for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
            try {
                const response = await axios_1.default.get(`${this.baseUrl}/generate/record-info`, {
                    params: { taskId },
                    headers: this.getHeaders()
                });
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
            }
            catch (error) {
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
    normalizeTrack(track) {
        return {
            id: track.id,
            audio_url: track.streamAudioUrl || track.audioUrl,
            title: track.title,
            status: 'complete',
            duration: track.duration,
            metadata: { tags: track.tags, imageUrl: track.imageUrl }
        };
    }
    async generate(prompt, instrumental = true, silent = false) {
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
            const response = await this.retryWithBackoff(() => axios_1.default.post(`${this.baseUrl}/generate`, {
                customMode: false,
                instrumental: instrumental,
                prompt: prompt.substring(0, 500), // Max 500 chars for non-custom mode
                model: 'V5',
                callBackUrl: 'https://localhost/callback' // Required by API, we use polling
            }, { headers: this.getHeaders() }));
            if (response.data.code !== 200) {
                throw new Error(`API error: ${response.data.msg}`);
            }
            const taskId = response.data.data.taskId;
            console.log(`SunoClient: Task created: ${taskId}`);
            // Poll for completion
            const { tracks, pollAttempts } = await this.pollForCompletion(taskId, startTime);
            return this.createResult(tracks, startTime, pollAttempts);
        }
        catch (error) {
            console.error('SunoClient Generate Error:', error);
            if (!silent) {
                console.log('SunoClient: API Failed. Falling back to Mock Data.');
                vscode.window.showWarningMessage('AgenticSuno: API failed/unavailable. Using Mock Data.');
            }
            const tracks = await this.getMockData(prompt);
            return this.createResult(tracks, startTime, 0);
        }
    }
    async extend(audioId, prompt, continueAt) {
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
            const response = await this.retryWithBackoff(() => axios_1.default.post(`${this.baseUrl}/generate/extend`, {
                audioId: audioId,
                prompt: prompt.substring(0, 500),
                continueAt: continueAt || 60,
                defaultParamFlag: true,
                model: 'V5',
                callBackUrl: 'https://localhost/callback' // Required by API, we use polling
            }, { headers: this.getHeaders() }));
            if (response.data.code !== 200) {
                throw new Error(`API error: ${response.data.msg}`);
            }
            const taskId = response.data.data.taskId;
            console.log(`SunoClient: Extend task created: ${taskId}`);
            // Poll for completion
            const { tracks, pollAttempts } = await this.pollForCompletion(taskId, startTime);
            return this.createResult(tracks, startTime, pollAttempts);
        }
        catch (error) {
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
    createResult(tracks, startTime, pollAttempts) {
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
    async getStatus(taskIds) {
        if (this.useMock) {
            return [];
        }
        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }
        const allTracks = [];
        for (const taskId of taskIds) {
            try {
                const response = await axios_1.default.get(`${this.baseUrl}/generate/record-info`, {
                    params: { taskId },
                    headers: this.getHeaders()
                });
                if (response.data.data.response?.sunoData) {
                    const tracks = response.data.data.response.sunoData.map(t => this.normalizeTrack(t));
                    allTracks.push(...tracks);
                }
            }
            catch (error) {
                console.error(`SunoClient Status Error for ${taskId}:`, error);
            }
        }
        return allTracks;
    }
    async getMockData(prompt, isExtension = false) {
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
exports.SunoClient = SunoClient;
//# sourceMappingURL=SunoClient.js.map