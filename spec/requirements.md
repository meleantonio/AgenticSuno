# Requirements

> **Format:** EARS (Easy Application Requirements Syntax)
> **Syntax:**
> - Ubiquitous: `<system> shall <response>`
> - Event-Driven: `WHEN <trigger> <optional precondition> the <system> shall <response>`
> - Unwanted: `IF <unwanted condition> THEN the <system> shall <response>`
> - State-Driven: `WHILE <system state>, the <system> shall <response>`
> - Optional: `WHERE <feature is included>, the <system> shall <response>`

---

## 1. Agent Activity Detection

### 1.1 Output Channel Monitoring
- **[REQ-1.1.1]** WHEN the extension activates, the extension shall begin monitoring VS Code output channels for known AI agent patterns (Antigravity, Gemini, Cursor AI, Copilot).
- **[REQ-1.1.2]** WHEN new text appears in a monitored output channel, the extension shall parse the text to extract agent activity signals (task start, task progress, errors, completions).
- **[REQ-1.1.3]** The extension shall maintain a configurable list of output channel name patterns to monitor.

### 1.2 Terminal Monitoring
- **[REQ-1.2.1]** WHEN a terminal shell execution starts, the extension shall analyze the command for AI agent invocations (e.g., `gemini`, `claude`, `cursor`).
- **[REQ-1.2.2]** WHEN a terminal shell execution ends, the extension shall record the exit status and duration.

### 1.3 File System Monitoring
- **[REQ-1.3.1]** The extension shall watch for changes to agent artifact directories (e.g., `.gemini/`, `.cursorrules`, `.claude/`).
- **[REQ-1.3.2]** WHEN agent artifacts are created or modified, the extension shall infer agent activity state.

---

## 2. Activity Classification

### 2.1 Mood Detection
- **[REQ-2.1.1]** The extension shall classify detected activity into one of the following moods: `epic`, `focused`, `tense`, `triumphant`, `ambient`.
- **[REQ-2.1.2]** WHEN error patterns are detected (keywords: "error", "failed", "exception", "retry"), the extension shall set mood to `tense`.
- **[REQ-2.1.3]** WHEN large task patterns are detected (keywords: "planning", "implementation plan", "major refactor"), the extension shall set mood to `epic`.
- **[REQ-2.1.4]** WHEN success patterns are detected (keywords: "complete", "success", "verified", "passed"), the extension shall set mood to `triumphant`.
- **[REQ-2.1.5]** WHILE no strong signals are present, the extension shall default mood to `focused`.

### 2.2 Intensity Scoring
- **[REQ-2.2.1]** The extension shall calculate an intensity score (0-100) based on: activity frequency, error count, task complexity indicators.
- **[REQ-2.2.2]** High intensity (>70) shall influence music generation toward faster tempo and fuller instrumentation.
- **[REQ-2.2.3]** Low intensity (<30) shall influence music generation toward slower tempo and sparse instrumentation.

### 2.3 Multi-Agent Detection
- **[REQ-2.3.1]** The extension shall track the number of concurrent active agents.
- **[REQ-2.3.2]** WHEN multiple agents are active, the extension shall request layered/orchestral music generation.

---

## 3. Music Generation (Suno API)

### 3.1 Initial Generation
- **[REQ-3.1.1]** WHEN agent activity begins and no music is playing, the extension shall generate an initial music clip (30-60 seconds) via Suno API.
- **[REQ-3.1.2]** The initial generation request shall include: project theme, current mood, intensity level.
- **[REQ-3.1.3]** The extension shall use Suno API v4.5 or v5 model for generation.

### 3.2 Continuous Extension
- **[REQ-3.2.1]** WHILE music is playing AND agent activity continues, the extension shall pre-emptively extend the current track using Suno's extend API.
- **[REQ-3.2.2]** Extension requests shall be triggered when remaining playback time falls below 15 seconds.
- **[REQ-3.2.3]** Extension requests shall include updated mood and intensity parameters to enable seamless transitions.

### 3.3 Mood Transitions
- **[REQ-3.3.1]** WHEN mood changes significantly, the extension shall use the `continueAt` parameter to branch the music at an appropriate transition point.
- **[REQ-3.3.2]** The extension shall maintain a buffer of 2-3 pre-generated clips to enable instant transitions.

### 3.4 Project Theme
- **[REQ-3.4.1]** WHEN extension is first activated in a workspace, the extension shall analyze project metadata (README, package.json, repo name) to generate a unique musical theme prompt.
- **[REQ-3.4.2]** The project theme shall persist across sessions and be stored in workspace state.
- **[REQ-3.4.3]** Users shall be able to regenerate or manually set the project theme.

---

## 4. Audio Playback

### 4.1 Integrated Player
- **[REQ-4.1.1]** The extension shall provide a webview-based audio player panel.
- **[REQ-4.1.2]** The player shall support seamless gapless playback between clips.
- **[REQ-4.1.3]** The player shall use Web Audio API for advanced audio manipulation (crossfading).

### 4.2 Playback Controls
- **[REQ-4.2.1]** The extension shall provide a status bar item showing current playback state (playing/paused/stopped).
- **[REQ-4.2.2]** WHEN user clicks the status bar item, the extension shall toggle play/pause.
- **[REQ-4.2.3]** The extension shall provide commands: `AgenticSuno: Play`, `AgenticSuno: Pause`, `AgenticSuno: Stop`, `AgenticSuno: Skip`.

### 4.3 Volume Control
- **[REQ-4.3.1]** The extension shall provide volume control via slider in the player panel.
- **[REQ-4.3.2]** Volume setting shall persist across sessions.
- **[REQ-4.3.3]** The extension shall provide a keyboard shortcut for quick mute/unmute.

---

## 5. Configuration

### 5.1 API Configuration
- **[REQ-5.1.1]** The extension shall require a Suno API key configuration setting.
- **[REQ-5.1.2]** IF Suno API key is not configured, THEN the extension shall show a notification prompting setup.
- **[REQ-5.1.3]** The extension shall validate API key on activation and show status in the player.

### 5.2 Behavior Settings
- **[REQ-5.2.1]** Users shall be able to enable/disable automatic playback on agent activity.
- **[REQ-5.2.2]** Users shall be able to configure monitored output channel patterns.
- **[REQ-5.2.3]** Users shall be able to set preferred music styles/genres.
- **[REQ-5.2.4]** Users shall be able to adjust intensity sensitivity.

### 5.3 Mock Mode
- **[REQ-5.3.1]** WHERE mock mode is enabled, the extension shall use pre-generated sample tracks instead of Suno API.
- **[REQ-5.3.2]** Mock mode shall enable full testing without consuming API credits.

---

## 6. User Interface

### 6.1 Player Panel
- **[REQ-6.1.1]** The player panel shall display: current track visualization, playback progress, mood indicator, volume slider.
- **[REQ-6.1.2]** The panel shall have a premium, modern dark-mode design with glassmorphism effects.
- **[REQ-6.1.3]** The panel shall display detected agent activity feed.

### 6.2 Status Bar
- **[REQ-6.2.1]** A status bar item shall show the current state: 🎵 (playing), ⏸️ (paused), 🔇 (muted), 💤 (idle).
- **[REQ-6.2.2]** Tooltip shall show current mood and track info.

### 6.3 Notifications
- **[REQ-6.3.1]** WHEN a new project theme is generated, the extension shall notify the user.
- **[REQ-6.3.2]** IF API errors occur, THEN the extension shall show non-blocking error notifications.

---

## Properties (Invariants)

*Universal statements that must always hold true.*

1. **[PROP-001]** The extension shall never block VS Code's main thread during music generation or playback.
2. **[PROP-002]** Music playback shall be completely stoppable at any time with no lingering audio.
3. **[PROP-003]** The extension shall degrade gracefully if Suno API is unavailable (silent mode, no errors).
4. **[PROP-004]** All API credentials shall be stored securely using VS Code's secrets API.
5. **[PROP-005]** Generated music clips shall be cached locally to minimize redundant API calls.
6. **[PROP-006]** The extension shall have minimal impact on VS Code performance (<50ms added activation time).
