import axios from 'axios';
import * as vscode from 'vscode';

export interface MusicTrack {
    id: string;
    audio_url: string;
    title?: string;
    status: 'submitted' | 'processing' | 'complete' | 'error';
    duration?: number;
    metadata?: any;
}

export class SunoClient {
    private baseUrl: string = 'https://api.suno.ai/v1'; // Placeholder URL, likely 3rd party or proxy
    private apiKey: string = '';
    private useMock: boolean = true;

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

    async generate(prompt: string, instrumental: boolean = true): Promise<MusicTrack[]> {
        console.log(`SunoClient: generate called. useMock=${this.useMock}, hasApiKey=${!!this.apiKey}`);

        if (this.useMock) {
            console.log('SunoClient: Generating Mock Data (Explicit)');
            return this.getMockData(prompt);
        }

        if (!this.apiKey) {
            console.warn('Suno API Key is missing. Falling back to Mock Data.');
            return this.getMockData(prompt);
        }

        try {
            // Note: This matches common 3rd party Suno API schemas
            console.log(`SunoClient: Sending request to ${this.baseUrl}/generation/generate`);
            const response = await axios.post(`${this.baseUrl}/generation/generate`, {
                prompt,
                make_instrumental: instrumental,
                wait_audio: false
            }, { headers: this.getHeaders() });

            return response.data as MusicTrack[];
        } catch (error: any) {
            console.error('SunoClient Generate Error:', error);
            // Fallback to mock on error to ensure user gets "something"
            console.log('SunoClient: API Failed. Falling back to Mock Data.');
            vscode.window.showWarningMessage('AgenticSuno: API failed/unavailable. Using Mock Data.');
            return this.getMockData(prompt);
        }
    }

    async extend(audioId: string, prompt: string, continueAt?: number): Promise<MusicTrack[]> {
        console.log(`SunoClient: extend called. useMock=${this.useMock}, hasApiKey=${!!this.apiKey}`);

        if (this.useMock) {
            console.log('SunoClient: Extending Mock Data');
            return this.getMockData(prompt, true);
        }

        if (!this.apiKey) {
            console.warn('Suno API Key is missing. Falling back to Mock Data.');
            return this.getMockData(prompt, true);
        }

        try {
            const response = await axios.post(`${this.baseUrl}/generation/extend`, {
                audio_id: audioId,
                prompt,
                continue_at: continueAt,
                wait_audio: false
            }, { headers: this.getHeaders() });

            return response.data as MusicTrack[];
        } catch (error: any) {
            console.error('SunoClient Extend Error:', error);
            // Fallback to mock on error
            console.log('SunoClient: Extend API Failed. Falling back to Mock Data.');
            vscode.window.showWarningMessage('AgenticSuno: Extend API failed. Using Mock Data.');
            return this.getMockData(prompt, true);
        }
    }


    async getStatus(ids: string[]): Promise<MusicTrack[]> {
        if (this.useMock) {
            return [];
        }

        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }

        try {
            const idsString = ids.join(',');
            const response = await axios.get(`${this.baseUrl}/generation/${idsString}`, {
                headers: this.getHeaders()
            });
            return response.data as MusicTrack[];
        } catch (error: any) {
            console.error('SunoClient Status Error:', error);
            throw error;
        }
    }

    private async getMockData(prompt: string, isExtension: boolean = false): Promise<MusicTrack[]> {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate latency

        // Return a reliable demo track (e.g., generic MP3)
        // Using a royalty-free placeholder for demonstration
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
