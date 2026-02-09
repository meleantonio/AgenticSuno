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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const MusicManager_1 = require("../../music/MusicManager");
suite('MusicManager Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    function createPlayerMock() {
        return {
            playTrack: () => { },
            playTrackWhenReady: () => { },
            stop: () => { },
            pause: () => { },
            resume: () => { },
            showGenerating: () => { },
            showGenerationComplete: () => { },
            updateState: () => { },
            addActivity: () => { },
            setLibrary: () => { },
            setProjectThemeAvailable: () => { },
            streamInit: () => { },
            streamChunk: () => { },
            streamPause: () => { },
            streamResume: () => { },
            streamStop: () => { },
            streamReset: () => { },
            streamError: () => { },
            resolveWebviewView: () => { },
        };
    }
    function createWorkspaceStateMock() {
        const workspaceStateMock = {
            get: () => undefined,
            update: () => Promise.resolve(),
            keys: () => [],
        };
        return workspaceStateMock;
    }
    test('Manager initializes with ambient mood', async () => {
        const manager = new MusicManager_1.MusicManager(createPlayerMock(), createWorkspaceStateMock());
        assert.strictEqual(manager.getCurrentMood(), 'ambient');
    });
    test('does not call Suno generate/extend when realtime Lyria is active', async () => {
        const manager = new MusicManager_1.MusicManager(createPlayerMock(), createWorkspaceStateMock());
        let generateCalls = 0;
        let extendCalls = 0;
        manager.generationEngine = {
            id: 'suno',
            generate: async () => {
                generateCalls += 1;
                return { tracks: [], metrics: { requestStartTime: Date.now(), completionTime: Date.now(), elapsedMs: 0, pollAttempts: 0 } };
            },
            extend: async () => {
                extendCalls += 1;
                return { tracks: [], metrics: { requestStartTime: Date.now(), completionTime: Date.now(), elapsedMs: 0, pollAttempts: 0 } };
            },
            getMockTrackForMood: () => ({ id: 'mock', audio_url: '', status: 'complete', title: 'mock' }),
        };
        manager.isPlaying = true;
        manager.realtimeActive = true;
        manager.playbackOrigin = 'lyria_realtime';
        manager.steerRealtimeSession = async () => { };
        manager.handleActivity({
            id: 'a-1',
            agentType: 'cursor',
            source: 'file_system',
            timestamp: Date.now(),
            rawText: 'Refactoring a complex websocket reconnection state machine right now',
            classification: { mood: 'epic', intensity: 90, taskPhase: 'execution', signals: ['refactor'] },
        });
        assert.strictEqual(generateCalls, 0);
        assert.strictEqual(extendCalls, 0);
    });
    test('URL library playback does not start extension scheduler', () => {
        const manager = new MusicManager_1.MusicManager(createPlayerMock(), createWorkspaceStateMock());
        manager.library = [{
                id: 'url-track-1',
                audio_url: 'https://cdn.example.com/track.mp3',
                title: 'URL track',
                mood: 'focused',
                generatedAt: Date.now(),
                engine: 'suno',
            }];
        manager.playLibraryTrackById('url-track-1');
        assert.strictEqual(manager.playbackOrigin, 'library_url');
        assert.strictEqual(manager.extensionTimer, undefined);
    });
    test('pause then resume in realtime path keeps session flags consistent', async () => {
        const manager = new MusicManager_1.MusicManager(createPlayerMock(), createWorkspaceStateMock());
        let pauseCalls = 0;
        let resumeCalls = 0;
        manager.lyriaEngine = {
            pause: async () => { pauseCalls += 1; },
            resume: async () => { resumeCalls += 1; },
        };
        manager.isPlaying = true;
        manager.realtimeActive = true;
        manager.isPaused = false;
        manager.pause();
        manager.resume();
        assert.strictEqual(pauseCalls, 1);
        assert.strictEqual(resumeCalls, 1);
        assert.strictEqual(manager.isPaused, false);
    });
    test('skip in realtime includes a fresh seed in generation config', async () => {
        const manager = new MusicManager_1.MusicManager(createPlayerMock(), createWorkspaceStateMock());
        let capturedConfig;
        let capturedPrompts;
        manager.lyriaEngine = {
            skip: async (prompts, config) => {
                capturedPrompts = prompts;
                capturedConfig = config;
            },
        };
        manager.isPlaying = true;
        manager.realtimeActive = true;
        manager.currentMood = 'focused';
        manager.currentIntensity = 55;
        manager.lastActivityHint = 'iterating on test coverage and playback behavior';
        await manager.skip();
        assert.ok(Array.isArray(capturedPrompts) && capturedPrompts.length > 0);
        assert.ok(typeof capturedConfig?.seed === 'number');
    });
});
//# sourceMappingURL=music.test.js.map