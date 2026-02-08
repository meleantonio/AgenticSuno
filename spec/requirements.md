# Requirements

## 1. Realtime Generation

- WHEN playback starts and `agenticSuno.engine` resolves to `lyria`, the extension shall open a Lyria realtime session from extension host.
- WHEN setup is acknowledged, the extension shall begin playback control with `PLAY` and stream chunks to webview.
- WHILE activity mood/intensity changes, the extension shall update weighted prompts and generation config without full reconnect in normal cases.
- WHEN user invokes skip in realtime mode, the extension shall send `RESET_CONTEXT` then apply fresh prompts/config.

## 2. Fallback Behavior

- IF `agenticSuno.geminiApiKey` is missing or realtime startup fails, THEN the extension shall fall back to Suno/mock path.
- The fallback path shall preserve existing controls (`start`, `pause`, `resume`, `stop`, `skip`) and URL playback behavior.

## 3. Host-Webview Protocol

- The extension host shall send stream protocol messages:
  - `streamInit`, `streamChunk`, `streamPause`, `streamResume`, `streamStop`, `streamReset`, `streamError`.
- The webview shall keep bounded chunk queues and deterministic stop/reset semantics.
- Legacy `play` URL message path shall remain supported.

## 4. Security

- Gemini API key shall never be posted to webview.
- Networking and protocol handling shall run in extension host only.

## 5. Persistence

- Existing library/theme data shall remain readable.
- New realtime presets (weighted prompts/config) shall be persistable in workspace state.

## 6. Verification

- Unit tests shall cover Lyria message parsing and steering mapping.
- Build/lint/tests shall pass in extension development host.
