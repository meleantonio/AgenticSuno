# Design Specification

## Architecture

```text
VS Code Extension Host
  ├─ ActivityMonitor
  ├─ MoodClassifier
  ├─ MusicManager
  │   ├─ LyriaEngineAdapter (primary)
  │   │   └─ LyriaClient (websocket + setup + reconnect)
  │   └─ SunoEngineAdapter (fallback)
  └─ PlayerViewProvider (host → webview protocol bridge)

Webview Player
  ├─ URL playback path (<audio>)
  └─ Realtime stream playback path (AudioContext chunk scheduler)
```

## Engine Selection

1. Read `agenticSuno.engine`.
2. `suno` => force Suno path.
3. `lyria` => use Lyria if `geminiApiKey` exists, else fallback Suno.
4. `auto` => prefer Lyria when key exists, else Suno.

## Lyria Session Lifecycle

1. Open websocket to Lyria endpoint in extension host.
2. Send setup (`model`).
3. Wait for `setupComplete`.
4. Send weighted prompts + generation config.
5. Send `PLAY`.
6. Parse and emit audio chunks to webview.
7. Handle controls: `PAUSE`, `PLAY`, `STOP`, `RESET_CONTEXT`.
8. On disconnect, apply bounded reconnect/backoff.

## Host-Webview Streaming Protocol

- `streamInit`: session metadata.
- `streamChunk`: ordered audio payload chunk (base64 + mime/sample metadata).
- `streamPause` / `streamResume`: playback state changes.
- `streamStop`: hard stop + cleanup.
- `streamReset`: reset queue/context while keeping session alive.
- `streamError`: non-fatal UI-facing error signal.

## Webview Playback Design

- Maintain bounded pending chunk queue.
- Decode chunk payloads to `AudioBuffer`.
- For PCM payloads, wrap PCM16 as WAV before decode.
- Schedule with `AudioContext.currentTime` + prebuffer offset.
- Support deterministic pause/resume/stop/reset.
- Keep legacy URL path operational for fallback/library tracks.

## Persistence Model

- `PersistedTrack` supports both:
  - Suno URL tracks (`engine: "suno"`, `audio_url`).
  - Lyria presets (`engine: "lyria"`, weighted prompts/config).
- `StoredProjectTheme` stores prompt plus optional engine-specific preset data.

## Security Posture

- API keys remain in extension host only.
- Webview receives only playback-safe metadata/chunks.
