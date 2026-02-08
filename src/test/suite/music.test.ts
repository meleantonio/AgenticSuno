
import * as assert from 'assert';
import * as vscode from 'vscode';
import { MusicManager } from '../../music/MusicManager';
import { PlayerViewProvider } from '../../ui/PlayerViewProvider';

suite('MusicManager Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Manager initializes with ambient mood', async () => {
        // Mock PlayerViewProvider
        const playerMock = {
            playTrack: (url: string) => { console.log('Mock Play:', url); },
            playTrackWhenReady: () => { },
            stop: () => { console.log('Mock Stop'); },
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
            resolveWebviewView: () => { }
        } as unknown as PlayerViewProvider;

        const workspaceStateMock: vscode.Memento = {
            get: () => undefined,
            update: () => Promise.resolve(),
            keys: () => [],
        };

        const manager = new MusicManager(playerMock, workspaceStateMock);

        assert.strictEqual(manager.getCurrentMood(), 'ambient');
    });
});
