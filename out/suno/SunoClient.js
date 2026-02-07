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
    baseUrl = 'https://api.suno.ai/v1'; // Placeholder URL, likely 3rd party or proxy
    apiKey = '';
    useMock = true;
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
    async generate(prompt, instrumental = true) {
        if (this.useMock) {
            console.log('SunoClient: Generating Mock Data');
            return this.getMockData(prompt);
        }
        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }
        try {
            // Note: This matches common 3rd party Suno API schemas
            const response = await axios_1.default.post(`${this.baseUrl}/generation/generate`, {
                prompt,
                make_instrumental: instrumental,
                wait_audio: false
            }, { headers: this.getHeaders() });
            return response.data;
        }
        catch (error) {
            console.error('SunoClient Generate Error:', error);
            throw error;
        }
    }
    async extend(audioId, prompt, continueAt) {
        if (this.useMock) {
            console.log('SunoClient: Extending Mock Data');
            return this.getMockData(prompt, true);
        }
        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/generation/extend`, {
                audio_id: audioId,
                prompt,
                continue_at: continueAt,
                wait_audio: false
            }, { headers: this.getHeaders() });
            return response.data;
        }
        catch (error) {
            console.error('SunoClient Extend Error:', error);
            throw error;
        }
    }
    async getStatus(ids) {
        if (this.useMock) {
            return [];
        }
        if (!this.apiKey) {
            throw new Error('Suno API Key is not configured.');
        }
        try {
            const idsString = ids.join(',');
            const response = await axios_1.default.get(`${this.baseUrl}/generation/${idsString}`, {
                headers: this.getHeaders()
            });
            return response.data;
        }
        catch (error) {
            console.error('SunoClient Status Error:', error);
            throw error;
        }
    }
    async getMockData(prompt, isExtension = false) {
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
exports.SunoClient = SunoClient;
//# sourceMappingURL=SunoClient.js.map