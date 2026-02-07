# 🎵 AgenticSuno: Adaptive AI Music for Coding Agents

**Code faster with a soundtrack that adapts to your AI agent's workflow.**

AgenticSuno is a VS Code extension that automatically generates and plays adaptive background music while your AI coding agents (like Cursor's Composer, GitHub Copilot, or Cline) are hard at work. It detects agent activity, analyzes the "mood" of the task, and uses the [Suno AI](https://suno.com/) API to generate an infinite, evolving soundtrack.

---

## ✨ Features

- **🤖 AI Activity Detection**: Automatically detects when AI agents are generating code, running terminal commands, or modifying files in your workspace.
- **🎭 Adaptive Moods**: The music shifts based on what the agent is doing:
  - **Focus Mode**: Chill lo-fi beats during normal coding tasks.
  - **Tension**: Suspenseful dark ambient music when errors or bugs are detected.
  - **Triumph**: Epic, uplifting orchestral scores when tasks are successfully completed.
  - **Ambient**: Calm, minimal soundscapes when idle.
- **⚡ Zero Latency Playback**: Intelligently pre-generates and caches music in the background so the soundtrack never stops.
- **🎛️ Integrated Player**: dedicated sidebar player and status bar controls to pause, skip, or change the vibe instantly.
- **♾️ Infinite Flow**: Automatically extends tracks before they end, creating a seamless, never-ending stream of unique music.
- **🛠️ Mock Mode**: Includes a built-in mock mode for testing without using API credits.

## 🚀 How It Works

1.  **Detection**: The extension monitors your `Output`, `Terminal`, and File System for specific patterns indicating AI agent activity (e.g. "Generating code...", "Error:", "Test passed").
2.  **Classification**: It analyzes the context to determine the current "Mood" (e.g., `focused`, `tense`, `triumphant`) and "Intensity".
3.  **Generation**: It sends a prompt to the Suno API (via `sunoapi.org` unofficial wrapper) to generate instrumental tracks tailored to that specific mood.
4.  **Playback**: The music plays directly in VS Code. As the agent's state changes, the music transitions to match.

## 📦 Installation

1.  Clone this repository.
2.  Run `npm install` to install dependencies.
3.  Open the folder in VS Code.
4.  Press `F5` to launch the extension in a new Extension Development Host window.

## ⚙️ Configuration

You can customize AgenticSuno in your VS Code settings (`Cmd+,` -> Search "AgenticSuno").

| Setting | Default | Description |
| :--- | :--- | :--- |
| `agenticSuno.apiKey` | `""` | Your Suno API Key (required for real generation). |
| `agenticSuno.useMock` | `true` | Set to `false` to use the real Suno API. Defaults to `true` for free testing. |
| `agenticSuno.autoPlayOnActivity` | `true` | Automatically start playing music when agent activity is detected. |
| `agenticSuno.styles.working` | `"lo-fi beats..."` | Custom prompt for the "Working" / "Focus" state. |
| `agenticSuno.styles.error` | `"dark ambient..."` | Custom prompt for the "Error" / "Tense" state. |
| `agenticSuno.styles.success` | `"uplifting..."` | Custom prompt for the "Success" / "Triumph" state. |

## 🔑 API Setup

This extension currently uses an unofficial wrapper for the Suno API. To use the real generation features:

1.  Obtain an API Key from your Suno provider (or self-hosted instance of the unofficial API).
2.  Set `agenticSuno.apiKey` in your VS Code settings.
3.  Set `agenticSuno.useMock` to `false`.

*> **Note:** By default, the extension runs in **Mock Mode**, playing royalty-free demo tracks so you can test the UI and logic without an API key.*

## 🎮 Controls

- **Status Bar**: Click the music note icon to Toggle Play/Pause. Only appears when music is active.
- **Command Palette** (`Cmd+Shift+P`):
  - `AgenticSuno: Start Music` - Manually trigger the flow.
  - `AgenticSuno: Stop Music` - Stop playback and clear queue.
  - `AgenticSuno: Skip Track` - Force generation of the next track.
  - `AgenticSuno: Show Player` - Open the sidebar webview.

## 🏗️ Architecture

- `MusicManager`: Orchestrates usage of the Suno API, manages the play queue, and handles background caching.
- `ActivityMonitor`: Aggregates events from Terminals, Output Channels, and File Watchers to detect Agent start/stop events.
- `MoodClassifier`: Determines the appropriate musical response to the detected activity.
- `SunoClient`: Handles communication with the music generation API (with retry logic and polling).

## 📄 License

MIT

---

*Verified with Cursor Composer, Cline, and standard VS Code terminals.*
