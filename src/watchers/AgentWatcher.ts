import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentState {
    source: 'antigravity' | 'gemini' | 'claude' | 'cursor';
    status: 'idle' | 'working' | 'error' | 'success';
    intensity: number; // 1-10
    currentTask?: string;
}

export type AgentStateCallback = (state: AgentState) => void;

export interface IAgentWatcher {
    start(): void;
    stop(): void;
    onStateChange(callback: AgentStateCallback): void;
}

export class TaskFileWatcher implements IAgentWatcher {
    private watcher: vscode.FileSystemWatcher | undefined;
    private callbacks: AgentStateCallback[] = [];
    private lastState: AgentState | undefined;

    constructor(private workspaceRoot: string) { }

    start(): void {
        const pattern = new vscode.RelativePattern(this.workspaceRoot, '**/.agent/task.md'); // Adjust path as needed
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.watcher.onDidChange(uri => this.checkFile(uri));
        this.watcher.onDidCreate(uri => this.checkFile(uri));

        // Initial check
        this.findAndCheckFile();
    }

    stop(): void {
        this.watcher?.dispose();
    }

    onStateChange(callback: AgentStateCallback): void {
        this.callbacks.push(callback);
    }

    private async findAndCheckFile() {
        const files = await vscode.workspace.findFiles('**/.agent/task.md', '**/node_modules/**', 1);
        if (files.length > 0) {
            this.checkFile(files[0]);
        }
    }

    private async checkFile(uri: vscode.Uri) {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            const state = this.parseTaskFile(text);

            if (this.hasStateChanged(state)) {
                this.lastState = state;
                this.notify(state);
            }
        } catch (err) {
            console.error('Error reading task file:', err);
        }
    }

    private parseTaskFile(text: string): AgentState {
        // Simple heuristic parsing
        // Look for In Progress marker [/]
        const lines = text.split('\n');
        let currentTask = '';
        let isWorking = false;

        for (const line of lines) {
            if (line.includes('[ ]')) continue;
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

    private hasStateChanged(newState: AgentState): boolean {
        if (!this.lastState) return true;
        return newState.status !== this.lastState.status ||
            newState.currentTask !== this.lastState.currentTask ||
            newState.intensity !== this.lastState.intensity;
    }

    private notify(state: AgentState) {
        this.callbacks.forEach(cb => cb(state));
    }
}
