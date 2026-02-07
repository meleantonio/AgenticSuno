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
class MusicManager {
    playerProvider;
    client;
    queue = [];
    currentTrack;
    state = { source: 'antigravity', status: 'idle', intensity: 1 };
    isPlaying = false;
    constructor(playerProvider) {
        this.playerProvider = playerProvider;
        this.client = new SunoClient_1.SunoClient();
    }
    async handleStateChange(newState) {
        if (this.shouldUpdateMusic(newState)) {
            console.log(`MusicManager: State changed to ${newState.status} (${newState.intensity})`);
            this.state = newState;
            // If we are idle, maybe pause or switch to ambient?
            // If we are working, ensure queue has music.
            if (newState.status === 'working' && !this.currentTrack) {
                await this.startFlow();
            }
        }
    }
    shouldUpdateMusic(newState) {
        return newState.status !== this.state.status || newState.intensity !== this.state.intensity;
    }
    async startFlow() {
        if (this.isPlaying)
            return;
        this.isPlaying = true;
        try {
            const prompt = this.getPromptForState(this.state);
            vscode.window.showInformationMessage(`AgenticSuno: Generating music for ${this.state.status}...`);
            const tracks = await this.client.generate(prompt);
            if (tracks && tracks.length > 0) {
                this.queue.push(...tracks);
                this.playNext();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage('AgenticSuno: Failed to generate music.');
            this.isPlaying = false;
        }
    }
    stop() {
        this.isPlaying = false;
        this.queue = [];
        this.currentTrack = undefined;
        this.playerProvider.stop();
    }
    async playNext() {
        if (this.queue.length === 0)
            return;
        this.currentTrack = this.queue.shift();
        if (this.currentTrack) {
            this.playerProvider.playTrack(this.currentTrack.audio_url, this.currentTrack.title || 'Generated Track', this.currentTrack.metadata?.tags || this.getPromptForState(this.state));
        }
        // Prefetch next track if queue is empty
        if (this.queue.length === 0) {
            this.extendFlow();
        }
    }
    async extendFlow() {
        if (!this.currentTrack)
            return;
        try {
            // Extend the current track to maintain flow
            const prompt = this.getPromptForState(this.state);
            console.log('MusicManager: Extending flow...');
            const tracks = await this.client.extend(this.currentTrack.id, prompt);
            if (tracks && tracks.length > 0) {
                this.queue.push(...tracks);
            }
        }
        catch (error) {
            console.error('Failed to extend flow:', error);
        }
    }
    getPromptForState(state) {
        const config = vscode.workspace.getConfiguration('agenticSuno');
        if (state.status === 'error') {
            return config.get('styles.error') || 'dark, tension';
        }
        if (state.status === 'success') {
            return config.get('styles.success') || 'uplifting, epic';
        }
        // Default working
        let basePrompt = config.get('styles.working') || 'lo-fi beats, focus';
        if (state.intensity > 7) {
            basePrompt += ', fast tempo, intense';
        }
        else if (state.intensity < 4) {
            basePrompt += ', chill, slow';
        }
        return basePrompt;
    }
}
exports.MusicManager = MusicManager;
//# sourceMappingURL=MusicManager.js.map