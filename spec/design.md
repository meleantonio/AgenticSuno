# Design: AgenticSuno

## Architecture
The system follows a modular architecture within a VS Code Extension.

### Components
1.  **Extension Host (Backend)**
    - **`SunoClient`**: Wrapper around the Suno API. Handles authentication, generation, extension, and polling for status.
    - **`MusicManager`**: The core logic. Manages the playback queue, handles seamless transitions (prefetching extensions), and maps "Agent State" to "Music Prompts".
    - **`AgentWatcher`**: A service that monitors external signals to determine the current "Agent State".
        - *Strategy pattern* to support multiple sources: `TaskFileWatcher` (Antigravity), `HttpServerWatcher` (CLI/External agents).
    - **`PlayerViewProvider`**: Manages the Webview for audio playback.

2.  **Webview (Frontend)**
    - **`AudioPlayer`**: A React/standard HTML5 audio player component. Receiver of audio URLs from the host. Reports playback progress (timeupdate) back to the host to trigger extensions.

## Data Models

### AgentState
```typescript
interface AgentState {
  source: 'antigravity' | 'gemini' | 'claude' | 'cursor';
  status: 'idle' | 'working' | 'error' | 'success';
  intensity: number; // 1-10 (1=Relaxed, 10=Epic/Crisis)
  currentTask?: string;
}
```

### MusicTrack
```typescript
interface MusicTrack {
  id: string;          // Suno Clip ID
  audioUrl: string;    // Stream URL
  duration: number;
  prompt: string;
  style: string;
  isExtension: boolean;
  parentId?: string;   // ID of the clip being extended
}
```

## detailed Workflows

### 1. Music Generation Loop
1.  **Trigger:** AgentState changes to `working` (Intensity 5).
2.  **Action:** `MusicManager` constructs a prompt (e.g., "Lo-fi beats for coding, focus, intensity 5").
3.  **Call:** `SunoClient.generate(prompt)`.
4.  **Result:** Receive `audioUrl`.
5.  **Playback:** Send `audioUrl` to Webview.

### 2. Seamless Extension (Infinite Flow)
1.  **Monitor:** Webview sends `playbackUpdate` event (e.g., "current: 80s, duration: 120s").
2.  **Trigger:** Time remaining < `PREFETCH_THRESHOLD` (e.g., 30s).
3.  **Action:** `MusicManager` calls `SunoClient.extend(currentTrackId)`.
    - *Prompt:* Same style or evolved based on new AgentState.
4.  **Result:** New track ready.
5.  **Transition:** Webview queues the new track. When Track A ends, Track B starts immediately (gapless logic handled in Frontend).

## Interfaces

### Suno API (Internal Abstraction)
```typescript
interface ISunoAPI {
  generate(prompt: string, instrumental: boolean): Promise<MusicTrack[]>;
  extend(audioId: string, prompt: string): Promise<MusicTrack[]>;
  getStatus(ids: string[]): Promise<MusicTrack[]>;
}
```

## Security & Privacy
- API Keys stored in VS Code `SecretStorage`.
- No code content sent to Suno. Only "Task Descriptions" (if configured) or generic style prompts.
