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
                    this._onTimeUpdate(data.currentTime, data.duration);
                    break;
                case 'ended':
                    this._onTrackEnded();
                    break;
                case 'log':
                    console.log('Webview Log:', data.message);
                    break;
            }
        });
    }
    playTrack(url, title, style) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'play', url, title, style });
        }
    }
    stop() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'stop' });
        }
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'player.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
				<title>AgenticSuno Player</title>
			</head>
			<body>
                <div id="player-container">
                    <div id="info">
                        <h3 id="track-title">Waiting for Agents...</h3>
                        <p id="track-style">Idle</p>
                    </div>
                    <audio id="audio-element" controls style="width: 100%"></audio>
                </div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}
exports.PlayerViewProvider = PlayerViewProvider;
//# sourceMappingURL=PlayerViewProvider.js.map