# AgenticSuno - Coding Standards

> **Purpose:** Steer the AI on style, patterns, and forbidden practices.

## General

- **Language**: TypeScript (strict mode)
- **Runtime**: VS Code Extension Host (Node.js 18+)
- **Framework**: VS Code Extension API, Web Audio API (in Webview)
- **Build**: Webpack (already configured)

## Project Structure

```
src/
├── extension.ts           # Entry point, activation
├── config/                # Configuration management
│   └── configManager.ts
├── activity/              # Agent activity detection
│   ├── outputMonitor.ts
│   ├── terminalMonitor.ts
│   ├── fileMonitor.ts
│   └── activityMonitor.ts # Facade
├── classification/        # Mood and intensity
│   └── moodClassifier.ts
├── music/                 # Music orchestration
│   ├── orchestrator.ts
│   ├── sunoClient.ts
│   └── audioManager.ts
├── ui/                    # UI components
│   ├── playerPanel.ts     # Webview panel
│   └── statusBar.ts
├── cache/                 # Clip caching
│   └── clipCache.ts
└── types/                 # Type definitions
    └── index.ts
media/
├── player.html
├── player.css
└── player.js
```

## Patterns

### 1. Event-Driven Architecture
- Use `vscode.EventEmitter<T>` for component communication
- Components expose `onXxx: Event<T>` properties
- Prefer reactive patterns over polling

### 2. Dependency Injection
- Pass dependencies via constructor
- Enable mock injection for testing
- Use interfaces for testability

### 3. Async/Await
- All I/O operations must be async
- Use `Promise.race` for timeouts
- Never block the extension host

### 4. Error Handling
- Wrap external API calls in try/catch
- Log errors to output channel
- Degrade gracefully, never crash

## Forbidden Practices

- ❌ `any` type (use `unknown` + type guards)
- ❌ Synchronous file I/O
- ❌ Storing secrets in settings (use `secrets` API)
- ❌ Hardcoded API URLs (use constants)
- ❌ `console.log` (use output channel)
- ❌ Inline styles in webview (use CSS file)

## Testing

- Unit tests: `src/test/suite/*.test.ts`
- Run: `npm test`
- Mock Suno API in tests

## Examples

### Good: Event-based communication
```typescript
class ActivityMonitor {
  private _onActivity = new vscode.EventEmitter<AgentActivity>();
  readonly onActivity = this._onActivity.event;
  
  private handleOutput(text: string) {
    const activity = this.classify(text);
    this._onActivity.fire(activity);
  }
}
```

### Bad: Direct coupling
```typescript
// DON'T DO THIS
class ActivityMonitor {
  constructor(private orchestrator: MusicOrchestrator) {}
  
  private handleOutput(text: string) {
    this.orchestrator.handleActivity(text); // Tight coupling!
  }
}
```
