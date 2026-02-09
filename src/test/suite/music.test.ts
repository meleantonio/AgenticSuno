
import * as assert from 'assert';
import * as vscode from 'vscode';
import { MusicManager } from '../../music/MusicManager';
import { PlayerViewProvider } from '../../ui/PlayerViewProvider';
import { LyriaGenerationConfig, LyriaWeightedPrompt } from '../../lyria/types';

suite('MusicManager Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    function createPlayerMock(): PlayerViewProvider {
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
        } as unknown as PlayerViewProvider;
    }

    function createWorkspaceStateMock(): vscode.Memento {
        const workspaceStateMock: vscode.Memento = {
            get: () => undefined,
            update: () => Promise.resolve(),
            keys: () => [],
        };
        return workspaceStateMock;
    }

    test('Manager initializes with ambient mood', async () => {
        const manager = new MusicManager(createPlayerMock(), createWorkspaceStateMock());
        assert.strictEqual(manager.getCurrentMood(), 'ambient');
    });

    test('does not call Suno generate/extend when realtime Lyria is active', async () => {
        const manager = new MusicManager(createPlayerMock(), createWorkspaceStateMock());

        let generateCalls = 0;
        let extendCalls = 0;
        (manager as any).generationEngine = {
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

        (manager as any).isPlaying = true;
        (manager as any).realtimeActive = true;
        (manager as any).playbackOrigin = 'lyria_realtime';
        (manager as any).steerRealtimeSession = async () => { };

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
        const manager = new MusicManager(createPlayerMock(), createWorkspaceStateMock());
        (manager as any).library = [{
            id: 'url-track-1',
            audio_url: 'https://cdn.example.com/track.mp3',
            title: 'URL track',
            mood: 'focused',
            generatedAt: Date.now(),
            engine: 'suno',
        }];

        manager.playLibraryTrackById('url-track-1');

        assert.strictEqual((manager as any).playbackOrigin, 'library_url');
        assert.strictEqual((manager as any).extensionTimer, undefined);
    });

    test('pause then resume in realtime path keeps session flags consistent', async () => {
        const manager = new MusicManager(createPlayerMock(), createWorkspaceStateMock());
        let pauseCalls = 0;
        let resumeCalls = 0;

        (manager as any).lyriaEngine = {
            pause: async () => { pauseCalls += 1; },
            resume: async () => { resumeCalls += 1; },
        };
        (manager as any).isPlaying = true;
        (manager as any).realtimeActive = true;
        (manager as any).isPaused = false;

        manager.pause();
        manager.resume();

        assert.strictEqual(pauseCalls, 1);
        assert.strictEqual(resumeCalls, 1);
        assert.strictEqual((manager as any).isPaused, false);
    });

    test('skip in realtime includes a fresh seed in generation config', async () => {
        const manager = new MusicManager(createPlayerMock(), createWorkspaceStateMock());

        let capturedConfig: LyriaGenerationConfig | undefined;
        let capturedPrompts: LyriaWeightedPrompt[] | undefined;
        (manager as any).lyriaEngine = {
            skip: async (prompts: LyriaWeightedPrompt[], config: LyriaGenerationConfig) => {
                capturedPrompts = prompts;
                capturedConfig = config;
            },
        };

        (manager as any).isPlaying = true;
        (manager as any).realtimeActive = true;
        (manager as any).currentMood = 'focused';
        (manager as any).currentIntensity = 55;
        (manager as any).lastActivityHint = 'iterating on test coverage and playback behavior';

        await manager.skip();

        assert.ok(Array.isArray(capturedPrompts) && capturedPrompts.length > 0);
        assert.ok(typeof capturedConfig?.seed === 'number');
    });
});
