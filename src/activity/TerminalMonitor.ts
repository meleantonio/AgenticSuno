import * as vscode from 'vscode';
import { AgentActivity, AgentType } from '../types';

/**
 * Monitors VS Code integrated terminal for AI agent CLI invocations.
 * Tracks command duration and detects gemini, claude, cursor CLI tools.
 */
export class TerminalMonitor {
    private _onActivity = new vscode.EventEmitter<AgentActivity>();
    readonly onActivity = this._onActivity.event;

    private disposables: vscode.Disposable[] = [];
    private activeCommands = new Map<string, { agentType: AgentType; startTime: number; command: string }>();

    // CLI command patterns
    private readonly cliPatterns: Map<AgentType, RegExp[]> = new Map([
        ['gemini', [/^gemini\s/i, /gemini-cli/i]],
        ['claude', [/^claude\s/i, /claude-code/i]],
        ['cursor', [/^cursor\s/i]],
    ]);

    constructor() {
        console.log('TerminalMonitor: Initialized');
    }

    start(): void {
        console.log('TerminalMonitor: Starting...');

        // Monitor terminal shell execution start
        const startListener = vscode.window.onDidStartTerminalShellExecution?.((e) => {
            this.handleExecutionStart(e);
        });

        // Monitor terminal shell execution end
        const endListener = vscode.window.onDidEndTerminalShellExecution?.((e) => {
            this.handleExecutionEnd(e);
        });

        if (startListener) {
            this.disposables.push(startListener);
        }
        if (endListener) {
            this.disposables.push(endListener);
        }

        // Fallback: Monitor terminal open events
        const terminalOpenListener = vscode.window.onDidOpenTerminal((terminal) => {
            console.log(`TerminalMonitor: Terminal opened - ${terminal.name}`);
        });
        this.disposables.push(terminalOpenListener);
    }

    stop(): void {
        console.log('TerminalMonitor: Stopping...');
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private handleExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
        const commandLine = event.execution.commandLine?.value || '';
        const agentType = this.detectAgentFromCommand(commandLine);

        if (agentType !== 'unknown') {
            const terminalId = this.getTerminalId(event.terminal);
            console.log(`TerminalMonitor: Agent CLI started - ${agentType}: ${commandLine}`);

            this.activeCommands.set(terminalId, {
                agentType,
                startTime: Date.now(),
                command: commandLine,
            });

            const activity: AgentActivity = {
                id: `terminal-start-${Date.now()}`,
                agentType,
                source: 'terminal',
                timestamp: Date.now(),
                rawText: `Started: ${commandLine}`,
                classification: {
                    mood: 'epic', // Starting a CLI command is usually significant
                    intensity: 60,
                    taskPhase: 'execution',
                    signals: ['cli-start', agentType],
                },
            };

            this._onActivity.fire(activity);
        }
    }

    private handleExecutionEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const terminalId = this.getTerminalId(event.terminal);
        const commandInfo = this.activeCommands.get(terminalId);

        if (commandInfo) {
            const duration = Date.now() - commandInfo.startTime;
            const exitCode = event.exitCode;

            console.log(`TerminalMonitor: Agent CLI ended - ${commandInfo.agentType}, duration=${duration}ms, exit=${exitCode}`);

            const isError = exitCode !== undefined && exitCode !== 0;
            const activity: AgentActivity = {
                id: `terminal-end-${Date.now()}`,
                agentType: commandInfo.agentType,
                source: 'terminal',
                timestamp: Date.now(),
                rawText: `Ended: ${commandInfo.command} (exit: ${exitCode}, duration: ${duration}ms)`,
                classification: {
                    mood: isError ? 'tense' : 'triumphant',
                    intensity: isError ? 80 : 50,
                    taskPhase: 'verification',
                    signals: isError ? ['cli-error', 'exit-code-' + exitCode] : ['cli-complete'],
                },
            };

            this._onActivity.fire(activity);
            this.activeCommands.delete(terminalId);
        }
    }

    private detectAgentFromCommand(command: string): AgentType {
        for (const [agent, patterns] of this.cliPatterns) {
            for (const pattern of patterns) {
                if (pattern.test(command)) {
                    return agent;
                }
            }
        }
        return 'unknown';
    }

    private getTerminalId(terminal: vscode.Terminal): string {
        // Use name + creation timestamp as unique identifier (processId is async)
        return `${terminal.name}-${terminal.creationOptions?.name || 'default'}`;
    }

    dispose(): void {
        this.stop();
        this._onActivity.dispose();
    }
}
