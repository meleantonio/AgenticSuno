# Requirements: AgenticSuno

## Functional Requirements (EARS)

### Authentication & Configuration
- **REQ-001:** The system **shall** allow the user to provide a Suno API key via VS Code settings.
- **REQ-002:** The system **shall** allow the user to map agent events (e.g., "Start Task", "Error", "Success") to specific musical style prompts.

### Music Generation
- **REQ-003:** **When** an agent starts a task, the system **shall** generate a music clip using the Suno API based on the task's complexity ("intensity").
- **REQ-004:** **While** the agent is in the "Working" state, the system **shall** continuously extend the playing music track to ensure seamless playback.
- **REQ-005:** **When** the agent encounters an error or critical issue, the system **shall** extend the current track with a "darker" or more tense prompt.
- **REQ-006:** **When** the agent completes a major task, the system **shall** extend the track with an "epic" or resolved musical theme.
- **REQ-007:** **If** the Suno API fails to generate a clip, the system **shall** retry with exponential backoff or loop the current segment (if available).

### Integration & State Tracking
- **REQ-008:** The system **shall** monitor the `.agent/task.md` file (for Antigravity) to detect task changes and updates.
- **REQ-009:** The system **shall** expose a local command or API (e.g., HTTP server or CLI command) for external tools (Gemini CLI, Claude Code) to report their status.

### Playback UI
- **REQ-010:** The system **shall** provide a VS Code Webview panel ("AgenticSuno Player") to control playback (Play/Pause, Volume, Skip).
- **REQ-011:** The player **shall** display the currently playing track's title, style, and the "Agent State" that triggered it.

## Non-Functional Requirements & Properties
- **PROP-001 (Latency):** The system should pre-fetch/generate extensions before the current track ends to minimize silence gaps.
- **PROP-002 (Privacy):** The system **shall** not send user code or sensitive file content to the Suno API; only high-level status descriptions (e.g., "Debugging", "Refactoring") and style prompts.
- **PROP-003 (Resource Usage):** The extension should not block the main VS Code thread; audio processing and API calls must be asynchronous.
