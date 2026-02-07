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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const MusicManager_1 = require("./music/MusicManager");
const PlayerViewProvider_1 = require("./ui/PlayerViewProvider");
const AgentWatcher_1 = require("./watchers/AgentWatcher");
function activate(context) {
    console.log('AgenticSuno is activating...');
    try {
        // 1. Register Commands (Do this first so they are always available)
        // We will initialize logic lazily or update it later
        let musicManager;
        let startDisposable = vscode.commands.registerCommand('agenticSuno.start', async () => {
            if (!musicManager) {
                vscode.window.showErrorMessage('AgenticSuno: Music Manager not initialized (Is a workspace open?)');
                return;
            }
            vscode.window.showInformationMessage('AgenticSuno: Starting Music Flow...');
            await musicManager.startFlow();
        });
        let stopDisposable = vscode.commands.registerCommand('agenticSuno.stop', () => {
            if (!musicManager) {
                return;
            }
            vscode.window.showInformationMessage('AgenticSuno: Stopping Music.');
            musicManager.stop();
        });
        context.subscriptions.push(startDisposable);
        context.subscriptions.push(stopDisposable);
        // 2. Setup UI
        const provider = new PlayerViewProvider_1.PlayerViewProvider(context.extensionUri, (currentTime, duration) => {
            // handle time update
        }, () => {
            console.log('Track ended, requesting next...');
        });
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(PlayerViewProvider_1.PlayerViewProvider.viewType, provider));
        // 3. Setup Core Logic
        musicManager = new MusicManager_1.MusicManager(provider);
        // 4. Setup Watcher (Only if workspace exists)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceFolder) {
            const watcher = new AgentWatcher_1.TaskFileWatcher(workspaceFolder);
            watcher.onStateChange(async (state) => {
                await musicManager.handleStateChange(state);
            });
            watcher.start();
            context.subscriptions.push({ dispose: () => watcher.stop() });
            console.log('AgenticSuno: Watcher started on', workspaceFolder);
        }
        else {
            console.log('AgenticSuno: No workspace folder found. Watcher disabled.');
        }
        console.log('AgenticSuno activation complete.');
    }
    catch (err) {
        console.error('AgenticSuno Activation Failed:', err);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map