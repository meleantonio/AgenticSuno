# AgenticSuno

Adaptive background music for coding agents in VS Code.

AgenticSuno now uses **Google Lyria Realtime** as the primary engine for low-latency continuous music steering, with **Suno/mock fallback** preserved for compatibility.

## What Changed

- Primary engine: `Lyria Realtime` streaming from extension host to webview.
- Fallback engine: `Suno` URL playback (or mock mode) when Gemini key is missing/unavailable.
- Engine abstraction introduced in `src/music/engine/`.
- Host-side API key handling only (Gemini key is never posted to the webview).
- Webview now supports streaming protocol messages:
  - `streamInit`
  - `streamChunk`
  - `streamPause`
  - `streamResume`
  - `streamStop`
  - `streamReset`
  - `streamError`

## Features

- Detects coding-agent activity (output channels, terminal, file edits).
- Mood + intensity classification (`epic`, `focused`, `tense`, `triumphant`, `ambient`).
- Realtime mood steering without reconnect in normal operation.
- Sidebar player with play/pause/stop/skip and volume controls.
- Persisted project theme + track/preset library in workspace state.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `agenticSuno.engine` | `"auto"` | Engine selection: `auto`, `lyria`, `suno`. |
| `agenticSuno.geminiApiKey` | `""` | Gemini API key for Lyria realtime. |
| `agenticSuno.lyriaModel` | `"models/lyria-realtime-exp"` | Lyria model name. |
| `agenticSuno.lyriaStyleAnchor` | `"midnight ocean penthouse ambiance, executive deep-focus groove, polished downtempo electronic, warm bassline, soft keys, subtle percussion, no vocals"` | Base style text applied to all generated Lyria prompts. |
| `agenticSuno.apiKey` | `""` | Suno API key (fallback path). |
| `agenticSuno.useMock` | `false` | Mock fallback data for Suno path. |
| `agenticSuno.autoPlayOnActivity` | `true` | Auto-start on activity. |

## Security Model

- Gemini and Suno keys stay in extension host process.
- Keys are never sent to the webview.
- Stream payloads contain audio chunks and metadata only.

## Architecture Summary

- `MusicManager`: engine selection, activity steering, command orchestration.
- `LyriaClient`: websocket lifecycle, setup handshake, chunk parsing, reconnect/backoff.
- `LyriaEngineAdapter`: high-level session control (`PLAY`, `PAUSE`, `STOP`, `RESET_CONTEXT`).
- `SunoEngineAdapter`: Suno fallback behind a shared generation interface.
- `PlayerViewProvider` + `media/player.js`: host-webview protocol and streaming playback engine.

## Development

```bash
npm install
npm run compile
npm test
```

Open the repository in VS Code and press `F5` to run the extension host.
