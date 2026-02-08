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
const ui_1 = require("./ui");
const activity_1 = require("./activity");
// Legacy import for backward compatibility
const AgentWatcher_1 = require("./watchers/AgentWatcher");
let musicManager;
let activityMonitor;
let statusBarManager;
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('AgenticSuno');
    log('AgenticSuno is activating...');
    try {
        // 1. Setup UI - Register webview provider first
        const playerProvider = new ui_1.PlayerViewProvider(context.extensionUri, (currentTime, duration, remainingTime) => {
            // Time update callback
            if (musicManager) {
                musicManager.updateTimeRemaining(currentTime, duration, remainingTime);
            }
        }, () => {
            // Track ended callback
            log('Track ended');
            if (musicManager) {
                musicManager.skip();
            }
        });
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(ui_1.PlayerViewProvider.viewType, playerProvider, {
            webviewOptions: {
                retainContextWhenHidden: true, // Keep player webview alive when sidebar is closed or another tab is focused so music keeps playing
            },
        }));
        log('PlayerViewProvider registered');
        // 2. Setup Status Bar
        statusBarManager = new ui_1.StatusBarManager();
        context.subscriptions.push({ dispose: () => statusBarManager?.dispose() });
        log('StatusBarManager created');
        // 3. Setup Music Manager (with workspace state for persisted library)
        musicManager = new MusicManager_1.MusicManager(playerProvider, context.workspaceState);
        log('MusicManager created');
        musicManager.loadPersistedLibrary();
        // 4. Setup Activity Monitor
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        activityMonitor = new activity_1.ActivityMonitor(workspaceFolder);
        // Wire activity to music manager: start generation on first activity (e.g. user sent chat message)
        activityMonitor.onActivity((activity) => {
            log(`Activity detected: ${activity.agentType} - ${activity.classification.mood}`);
            musicManager?.handleActivity(activity);
            // Update status bar
            statusBarManager?.update({
                status: 'playing',
                mood: activity.classification.mood,
                agentCount: activityMonitor?.getActiveAgentCount(),
            });
            // Start music as soon as user sends a message (first activity); content drives mood
            const config = vscode.workspace.getConfiguration('agenticSuno');
            const autoPlay = config.get('autoPlayOnActivity') !== false;
            if (autoPlay && musicManager && !musicManager.isCurrentlyPlaying()) {
                statusBarManager?.setGenerating();
                musicManager.startFlowFromActivity(activity).then(() => {
                    const mood = musicManager?.getCurrentMood();
                    statusBarManager?.setPlaying(mood ?? 'focused');
                }).catch((e) => {
                    log(`Start from activity error: ${e}`);
                    statusBarManager?.setIdle();
                });
            }
        });
        activityMonitor.onAgentStart(({ agentType }) => {
            log(`Agent started: ${agentType}`);
            vscode.window.showInformationMessage(`AgenticSuno: Detected ${agentType} activity!`);
            // Music starts on first activity (startFlowFromActivity), not here, so content drives initial mood
        });
        activityMonitor.onAgentEnd(({ agentType, duration }) => {
            log(`Agent ended: ${agentType} after ${duration}ms`);
            // If no more active agents, show idle state
            if (activityMonitor?.getActiveAgentCount() === 0) {
                statusBarManager?.setIdle();
            }
        });
        activityMonitor.start();
        context.subscriptions.push({ dispose: () => activityMonitor?.dispose() });
        log('ActivityMonitor started');
        // 5. Legacy watcher for backward compatibility (file-based detection)
        if (workspaceFolder) {
            const legacyWatcher = new AgentWatcher_1.TaskFileWatcher(workspaceFolder);
            legacyWatcher.onStateChange(async (state) => {
                if (musicManager) {
                    await musicManager.handleStateChange(state);
                }
            });
            legacyWatcher.start();
            context.subscriptions.push({ dispose: () => legacyWatcher.stop() });
            log('Legacy TaskFileWatcher started');
        }
        // 6. Register Commands
        registerCommands(context, playerProvider);
        // Lazy project theme (after first paint)
        setTimeout(() => {
            musicManager?.ensureProjectTheme().catch((e) => log(`ensureProjectTheme: ${e}`));
        }, 5000);
        log('AgenticSuno activation complete!');
        vscode.window.showInformationMessage('AgenticSuno ready! AI agents will trigger music.');
    }
    catch (err) {
        console.error('AgenticSuno Activation Critical Error:', err);
        outputChannel.appendLine(`ERROR: ${err}`);
        vscode.window.showErrorMessage(`AgenticSuno Failed to Activate: ${err}`);
    }
}
function registerCommands(context, playerProvider) {
    // Start command
    const startCmd = vscode.commands.registerCommand('agenticSuno.start', async () => {
        try {
            await vscode.commands.executeCommand('agenticSuno.player.focus');
            if (!musicManager) {
                vscode.window.showErrorMessage('AgenticSuno: Music Manager not ready.');
                return;
            }
            statusBarManager?.setGenerating();
            vscode.window.showInformationMessage('AgenticSuno: Starting Music...');
            musicManager.startFlowWithImmediatePlayback();
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
        catch (e) {
            log(`Start error: ${e}`);
            statusBarManager?.showError('Failed to start');
            vscode.window.showErrorMessage(`AgenticSuno Start Error: ${e}`);
        }
    });
    // Stop command
    const stopCmd = vscode.commands.registerCommand('agenticSuno.stop', () => {
        if (musicManager) {
            musicManager.stop();
            statusBarManager?.setIdle();
            vscode.window.showInformationMessage('AgenticSuno: Music Stopped.');
        }
    });
    // Pause command
    const pauseCmd = vscode.commands.registerCommand('agenticSuno.pause', () => {
        if (musicManager) {
            musicManager.pause();
            statusBarManager?.setPaused();
        }
    });
    // Resume command  
    const resumeCmd = vscode.commands.registerCommand('agenticSuno.resume', () => {
        if (musicManager) {
            musicManager.resume();
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
    });
    // Toggle play/pause command (for status bar click)
    const toggleCmd = vscode.commands.registerCommand('agenticSuno.togglePlayPause', async () => {
        if (!musicManager)
            return;
        if (musicManager.isCurrentlyPlaying()) {
            musicManager.pause();
            statusBarManager?.setPaused();
        }
        else {
            // If already has tracks, resume, otherwise start fresh
            musicManager.resume();
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
    });
    // Skip command
    const skipCmd = vscode.commands.registerCommand('agenticSuno.skip', async () => {
        if (musicManager) {
            statusBarManager?.setGenerating();
            await musicManager.skip();
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
    });
    // Show player command
    const showPlayerCmd = vscode.commands.registerCommand('agenticSuno.showPlayer', async () => {
        await vscode.commands.executeCommand('agenticSuno.player.focus');
    });
    // Play project theme (first song for this repo)
    const playProjectThemeCmd = vscode.commands.registerCommand('agenticSuno.playProjectTheme', async () => {
        if (musicManager) {
            statusBarManager?.setGenerating();
            await musicManager.playProjectTheme();
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
    });
    // Play a track from the library by index
    const playLibraryTrackCmd = vscode.commands.registerCommand('agenticSuno.playLibraryTrack', (...args) => {
        const index = typeof args[0] === 'number'
            ? args[0]
            : typeof args[1] === 'number'
                ? args[1]
                : undefined;
        if (musicManager && typeof index === 'number') {
            musicManager.playLibraryTrack(index);
            statusBarManager?.setPlaying(musicManager.getCurrentMood());
        }
    });
    context.subscriptions.push(startCmd, stopCmd, pauseCmd, resumeCmd, toggleCmd, skipCmd, showPlayerCmd, playProjectThemeCmd, playLibraryTrackCmd);
    log('Commands registered');
}
function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[AgenticSuno] ${message}`);
    outputChannel?.appendLine(`[${timestamp}] ${message}`);
}
function deactivate() {
    log('AgenticSuno deactivating...');
    musicManager?.dispose();
    activityMonitor?.dispose();
    statusBarManager?.dispose();
}
//# sourceMappingURL=extension.js.map