import * as vscode from 'vscode';
import { Mood, MusicStatus, AgentActivity, PersistedTrack } from '../types';
import { LyriaAudioChunk } from '../lyria/types';

const MAX_PENDING_MESSAGES = 512;
const MAX_CHUNK_BASE64_LENGTH = 1_500_000;

interface StreamInitPayload {
    sessionId: string;
    sampleRateHz?: number;
    channels?: number;
    mimeType?: string;
}

export class PlayerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agenticSuno.player';

    private _view?: vscode.WebviewView;
    private _webviewReady = false;
    private _pendingMessages: Record<string, unknown>[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _onTimeUpdate: (currentTime: number, duration: number, remainingTime: number) => void,
        private readonly _onTrackEnded: () => void
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('PlayerViewProvider: resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data: Record<string, unknown>) => {
            switch (data.type) {
                case 'timeUpdate':
                    this._onTimeUpdate(Number(data.currentTime || 0), Number(data.duration || 0), Number(data.remainingTime || 0));
                    break;
                case 'ended':
                    this._onTrackEnded();
                    break;
                case 'log':
                    console.log('Webview Log:', data.message);
                    break;
                case 'error':
                    console.error('Webview Error:', data.message);
                    break;
                case 'skip':
                    void vscode.commands.executeCommand('agenticSuno.skip');
                    break;
                case 'playProjectTheme':
                    void vscode.commands.executeCommand('agenticSuno.playProjectTheme');
                    break;
                case 'startOrResume':
                    void vscode.commands.executeCommand('agenticSuno.start');
                    break;
                case 'pause':
                    void vscode.commands.executeCommand('agenticSuno.pause');
                    break;
                case 'resume':
                    void vscode.commands.executeCommand('agenticSuno.resume');
                    break;
                case 'stop':
                    void vscode.commands.executeCommand('agenticSuno.stop');
                    break;
                case 'playLibraryTrack':
                    if (typeof data.trackId === 'string' && data.trackId.length > 0) {
                        void vscode.commands.executeCommand('agenticSuno.playLibraryTrack', data.trackId);
                    } else if (typeof data.index === 'number') {
                        // Backward compatibility for older webview payloads.
                        void vscode.commands.executeCommand('agenticSuno.playLibraryTrack', data.index);
                    }
                    break;
                case 'mute':
                case 'volumeChange':
                    // Reserved for future persistence.
                    break;
                case 'webviewReady':
                    this._webviewReady = true;
                    this.flushPendingMessages();
                    break;
            }
        });
    }

    public playTrackWhenReady(url: string, title?: string, style?: string, mood?: Mood): void {
        this.postToWebview({ type: 'play', url, title, style, mood });
    }

    public playTrack(url: string, title?: string, style?: string, mood?: Mood): void {
        this.postToWebview({ type: 'play', url, title, style, mood });
    }

    public pause(): void {
        this.postToWebview({ type: 'pause' });
    }

    public resume(): void {
        this.postToWebview({ type: 'resume' });
    }

    public stop(): void {
        this.postToWebview({ type: 'stop' });
    }

    public setVolume(volume: number): void {
        this.postToWebview({ type: 'setVolume', volume });
    }

    public updateState(state: {
        mood?: Mood;
        intensity?: number;
        agentCount?: number;
        status?: MusicStatus;
    }): void {
        this.postToWebview({ type: 'updateState', ...state });
    }

    public addActivity(activity: AgentActivity): void {
        this.postToWebview({
            type: 'addActivity',
            activity: {
                timestamp: activity.timestamp,
                text: activity.rawText.substring(0, 80),
                agentType: activity.agentType,
                mood: activity.classification.mood,
            },
        });
    }

    public showGenerating(elapsedSeconds: number): void {
        this.postToWebview({ type: 'generatingUpdate', elapsedSeconds });
    }

    public setLibrary(tracks: PersistedTrack[]): void {
        this.postToWebview({
            type: 'setLibrary',
            tracks: tracks.map((t) => ({
                id: t.id,
                audio_url: t.audio_url,
                title: t.title,
                mood: t.mood,
                generatedAt: t.generatedAt,
                engine: t.engine,
            })),
        });
    }

    public setProjectThemeAvailable(available: boolean): void {
        this.postToWebview({ type: 'setProjectThemeAvailable', available });
    }

    public showGenerationComplete(totalSeconds: number): void {
        this.postToWebview({ type: 'generationComplete', totalSeconds });
    }

    public streamInit(payload: StreamInitPayload): void {
        this.postToWebview({
            type: 'streamInit',
            sessionId: payload.sessionId,
            sampleRateHz: payload.sampleRateHz ?? 48000,
            channels: payload.channels ?? 2,
            mimeType: payload.mimeType ?? 'audio/pcm;rate=48000;channels=2',
        });
    }

    public streamChunk(chunk: LyriaAudioChunk): void {
        if (!chunk.data || chunk.data.length > MAX_CHUNK_BASE64_LENGTH) {
            console.warn(`PlayerViewProvider: Dropped oversized/invalid stream chunk (seq=${chunk.sequence}).`);
            return;
        }

        this.postToWebview({
            type: 'streamChunk',
            sessionId: chunk.sessionId,
            sequence: chunk.sequence,
            data: chunk.data,
            mimeType: chunk.mimeType,
            sampleRateHz: chunk.sampleRateHz,
            channels: chunk.channels,
            receivedAt: chunk.receivedAt,
        });
    }

    public streamPause(): void {
        this.postToWebview({ type: 'streamPause' });
    }

    public streamResume(): void {
        this.postToWebview({ type: 'streamResume' });
    }

    public streamStop(): void {
        this.postToWebview({ type: 'streamStop' });
    }

    public streamReset(): void {
        this.postToWebview({ type: 'streamReset' });
    }

    public streamError(message: string): void {
        this.postToWebview({ type: 'streamError', message });
    }

    private postToWebview(message: Record<string, unknown>): void {
        if (!this._view || !this._webviewReady) {
            this._pendingMessages.push(message);
            if (this._pendingMessages.length > MAX_PENDING_MESSAGES) {
                this._pendingMessages.shift();
            }
            return;
        }

        void this._view.webview.postMessage(message);
    }

    private flushPendingMessages(): void {
        if (!this._view || !this._webviewReady || this._pendingMessages.length === 0) {
            return;
        }

        for (const message of this._pendingMessages) {
            void this._view.webview.postMessage(message);
        }
        this._pendingMessages = [];
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'player.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src https: blob:; connect-src https:;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>AgenticSuno Player</title>
            </head>
            <body>
                <!-- Audio Enable Overlay - Click to allow playback -->
                <div id="audio-enable-overlay" class="audio-overlay">
                    <button id="enable-audio-btn" class="enable-audio-btn">
                        🔊 Enable Audio
                    </button>
                    <p class="overlay-hint">Click to enable music playback</p>
                </div>

                <div id="player-container">
                    <!-- Now Playing Section -->
                    <div id="now-playing" class="glass-card">
                        <h3 id="track-title">Waiting for Agents...</h3>
                        <p id="track-style">Start an AI agent to begin</p>
                        <span id="mood-badge" class="ambient">AMBIENT</span>

                        <!-- Visualizer -->
                        <div id="visualizer-container"></div>

                        <!-- Progress Bar -->
                        <div id="progress-container">
                            <div id="progress-bar"></div>
                            <div id="progress-thumb"></div>
                        </div>
                        <div id="time-display">
                            <span id="current-time">0:00</span>
                            <span id="total-time">0:00</span>
                        </div>

                        <!-- Controls -->
                        <div id="controls">
                            <button class="control-btn primary" id="play-btn" title="Play/Pause">▶</button>
                            <button class="control-btn" id="stop-btn" title="Stop">⏹</button>
                            <button class="control-btn" id="skip-btn" title="Skip">⏭</button>
                        </div>

                        <!-- Volume -->
                        <div id="volume-container">
                            <span id="volume-icon">🔊</span>
                            <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="0.7">
                        </div>

                        <!-- Intensity -->
                        <div id="intensity-container">
                            <span id="intensity-label">Intensity</span>
                            <div id="intensity-bar">
                                <div id="intensity-fill"></div>
                            </div>
                            <span id="intensity-value">50%</span>
                        </div>
                    </div>

                    <!-- Project theme & Library -->
                    <div id="library-section" class="glass-card">
                        <div id="library-header">
                            <h4>Your tracks</h4>
                            <button type="button" id="library-toggle-btn" class="library-toggle-btn" aria-expanded="false" title="Show tracks">▸</button>
                        </div>
                        <div id="library-content" class="library-content collapsed">
                            <button type="button" id="play-project-theme-btn" class="library-btn" style="display: none;">
                                🎵 Play project theme
                            </button>
                            <p id="no-project-theme-hint" class="library-hint">No project theme yet. Start an agent or run "Start Music" to generate.</p>
                            <div id="library-list" class="library-list"></div>
                        </div>
                    </div>

                    <!-- Activity Feed -->
                    <div id="activity-section" class="glass-card">
                        <div id="activity-header">
                            <h4>Agent Activity</h4>
                            <span id="agent-count">0 active</span>
                        </div>
                        <div id="activity-feed">
                            <div class="activity-item">
                                <span class="activity-time">--:--</span>
                                <span class="activity-text">Waiting for AI agent activity...</span>
                            </div>
                        </div>
                    </div>

                    <!-- Hidden audio element -->
                    <audio id="audio-element" style="display: none;"></audio>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
