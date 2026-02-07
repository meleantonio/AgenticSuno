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
exports.TaskFileWatcher = void 0;
const vscode = __importStar(require("vscode"));
class TaskFileWatcher {
    workspaceRoot;
    watcher;
    callbacks = [];
    lastState;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    start() {
        const pattern = new vscode.RelativePattern(this.workspaceRoot, '**/.agent/task.md'); // Adjust path as needed
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange(uri => this.checkFile(uri));
        this.watcher.onDidCreate(uri => this.checkFile(uri));
        // Initial check
        this.findAndCheckFile();
    }
    stop() {
        this.watcher?.dispose();
    }
    onStateChange(callback) {
        this.callbacks.push(callback);
    }
    async findAndCheckFile() {
        const files = await vscode.workspace.findFiles('**/.agent/task.md', '**/node_modules/**', 1);
        if (files.length > 0) {
            this.checkFile(files[0]);
        }
    }
    async checkFile(uri) {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            const state = this.parseTaskFile(text);
            if (this.hasStateChanged(state)) {
                this.lastState = state;
                this.notify(state);
            }
        }
        catch (err) {
            console.error('Error reading task file:', err);
        }
    }
    parseTaskFile(text) {
        // Simple heuristic parsing
        // Look for In Progress marker [/]
        const lines = text.split('\n');
        let currentTask = '';
        let isWorking = false;
        for (const line of lines) {
            if (line.includes('[ ]'))
                continue;
            if (line.includes('[/]')) { // Custom "In Progress" marker
                isWorking = true;
                currentTask = line.replace('-', '').replace('[/]', '').trim();
                // Continue to find the last one? Or the first? 
                // Usually the last active one is the most relevant.
            }
            if (line.includes('[x]')) {
                // completed
            }
        }
        // Determine intensity based on keywords
        let intensity = 3;
        if (isWorking) {
            intensity = 5;
            const lowerTask = currentTask.toLowerCase();
            if (lowerTask.includes('fix') || lowerTask.includes('debug') || lowerTask.includes('error')) {
                return { source: 'antigravity', status: 'error', intensity: 7, currentTask };
            }
            if (lowerTask.includes('plan') || lowerTask.includes('design')) {
                return { source: 'antigravity', status: 'working', intensity: 4, currentTask };
            }
            if (lowerTask.includes('implement') || lowerTask.includes('create')) {
                return { source: 'antigravity', status: 'working', intensity: 6, currentTask };
            }
            if (lowerTask.includes('refactor') || lowerTask.includes('optimize')) {
                return { source: 'antigravity', status: 'working', intensity: 5, currentTask };
            }
            return { source: 'antigravity', status: 'working', intensity: 5, currentTask };
        }
        return { source: 'antigravity', status: 'idle', intensity: 1 };
    }
    hasStateChanged(newState) {
        if (!this.lastState)
            return true;
        return newState.status !== this.lastState.status ||
            newState.currentTask !== this.lastState.currentTask ||
            newState.intensity !== this.lastState.intensity;
    }
    notify(state) {
        this.callbacks.forEach(cb => cb(state));
    }
}
exports.TaskFileWatcher = TaskFileWatcher;
//# sourceMappingURL=AgentWatcher.js.map