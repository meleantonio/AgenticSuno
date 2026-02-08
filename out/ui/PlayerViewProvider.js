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
exports.PlayerViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class PlayerViewProvider {
    _extensionUri;
    _onTimeUpdate;
    _onTrackEnded;
    static viewType = 'agenticSuno.player';
    _view;
    constructor(_extensionUri, _onTimeUpdate, _onTrackEnded) {
        this._extensionUri = _extensionUri;
        this._onTimeUpdate = _onTimeUpdate;
        this._onTrackEnded = _onTrackEnded;
    }
    resolveWebviewView(webviewView, context, _token) {
        console.log('PlayerViewProvider: resolveWebviewView called');
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'timeUpdate':
                    this._onTimeUpdate(data.currentTime, data.duration, data.remainingTime);
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
                    vscode.commands.executeCommand('agenticSuno.skip');
                    break;
                case 'playProjectTheme':
                    vscode.commands.executeCommand('agenticSuno.playProjectTheme');
                    break;
                case 'playLibraryTrack':
                    if (typeof data.index === 'number') {
                        vscode.commands.executeCommand('agenticSuno.playLibraryTrack', data.index);
                    }
                    break;
                case 'mute':
                    // Handle mute state change
                    break;
                case 'volumeChange':
                    // Could persist volume here
                    break;
            }
        });
    }
    playTrack(url, title, style, mood) {
        console.log(`PlayerViewProvider: playTrack called with url=${url}`);
        if (this._view) {
            this._view.webview.postMessage({ type: 'play', url, title, style, mood });
        }
        else {
            console.error('PlayerViewProvider: _view is undefined, cannot play track');
        }
    }
    pause() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'pause' });
        }
    }
    resume() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'resume' });
        }
    }
    stop() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'stop' });
        }
    }
    setVolume(volume) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'setVolume', volume });
        }
    }
    updateState(state) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateState', ...state });
        }
    }
    addActivity(activity) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'addActivity',
                activity: {
                    timestamp: activity.timestamp,
                    text: activity.rawText.substring(0, 80),
                    agentType: activity.agentType,
                    mood: activity.classification.mood,
                }
            });
        }
    }
    /**
     * Show generating state with elapsed time
     */
    showGenerating(elapsedSeconds) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'generatingUpdate',
                elapsedSeconds
            });
        }
    }
    /**
     * Update the library list in the player (persisted + session tracks).
     */
    setLibrary(tracks) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'setLibrary',
                tracks: tracks.map((t) => ({
                    id: t.id,
                    audio_url: t.audio_url,
                    title: t.title,
                    mood: t.mood,
                    generatedAt: t.generatedAt,
                })),
            });
        }
    }
    /**
     * Tell the player whether a project theme is available (so it can show "Play project theme").
     */
    setProjectThemeAvailable(available) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'setProjectThemeAvailable', available });
        }
    }
    /**
     * Show generation complete with total time
     */
    showGenerationComplete(totalSeconds) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'generationComplete',
                totalSeconds
            });
        }
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'player.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src https:; connect-src https:;">
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
                        <h4>Your tracks</h4>
                        <button type="button" id="play-project-theme-btn" class="library-btn" style="display: none;">
                            🎵 Play project theme
                        </button>
                        <p id="no-project-theme-hint" class="library-hint">No project theme yet. Start an agent or run "Start Music" to generate.</p>
                        <div id="library-list" class="library-list"></div>
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
exports.PlayerViewProvider = PlayerViewProvider;
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=PlayerViewProvider.js.map