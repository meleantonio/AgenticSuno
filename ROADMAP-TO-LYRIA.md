# ROADMAP TO LYRIA

Date: February 8, 2026  
Project: AgenticSuno  
Goal: Pivot from Suno API clip generation to Google Lyria Realtime streaming with low-latency, continuous playback in VS Code.

## 1. Outcome Targets

1. First audible music in less than 10 seconds after Start or first detected activity.
2. Continuous music steering (mood/intensity updates) without requiring full reconnect in normal cases.
3. Gemini API key never leaves extension host; never sent to webview.
4. Play/Pause/Stop/Skip remain reliable and immediate.
5. Existing UX remains usable during migration (status bar, player, activity feed, volume).
6. Fallback mode continues to work when no Gemini key is configured.

## 2. Current Baseline (Code-Verified)

- Suno-centric orchestration in `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/MusicManager.ts`.
- Suno HTTP polling client in `/Users/antoniomele/Dropbox/github/AgenticSuno/src/suno/SunoClient.ts`.
- URL-based `<audio>` playback in `/Users/antoniomele/Dropbox/github/AgenticSuno/media/player.js`.
- Host-webview messaging in `/Users/antoniomele/Dropbox/github/AgenticSuno/src/ui/PlayerViewProvider.ts`.
- Commands and config contributed in `/Users/antoniomele/Dropbox/github/AgenticSuno/package.json`.
- Project theme/library persistence in workspace state via `MusicManager`.

## 3. Migration Principles

1. Keep the extension shippable at each phase.
2. Separate engine logic from orchestration before replacing behavior.
3. Prefer host-side networking and protocol handling; webview is playback/UI only.
4. Maintain backward compatibility for persisted data where possible.
5. Add test coverage for each risky boundary (protocol parsing, stream scheduling, session control).

## 4. Phase Plan

## Phase 0: Engine Abstraction and Safety Baseline

### Scope
- Introduce a music engine interface and decouple `MusicManager` from direct `SunoClient` calls.
- Keep Suno/mock as default implementation for no-regression baseline.

### Key Changes
- Add engine types and contracts under `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/` or `/Users/antoniomele/Dropbox/github/AgenticSuno/src/types/`.
- Wrap Suno behavior in a `SunoEngineAdapter`.
- Update `MusicManager` to depend on engine interface only.

### Acceptance Gate
- Existing commands (`start`, `stop`, `pause`, `resume`, `skip`, project theme, library play) still work with current behavior.
- No UI regressions and no TypeScript build regressions.

## Phase 1: Lyria Client in Extension Host

### Scope
- Implement a dedicated Lyria realtime client with connection lifecycle and message parsing.

### Key Changes
- Add `/Users/antoniomele/Dropbox/github/AgenticSuno/src/lyria/LyriaClient.ts`.
- Implement:
  - connect/disconnect
  - setup and setupComplete handshake
  - set weighted prompts
  - set generation config
  - playback control (`PLAY`, `PAUSE`, `STOP`, `RESET_CONTEXT`)
  - chunk emission callbacks/events
  - reconnect/backoff strategy
- Add config wiring for `geminiApiKey` and `lyriaModel`.

### Acceptance Gate
- Dev command/test path can establish session and receive audio chunk events.
- Recoverable network failures trigger bounded reconnect attempts without crashing extension host.

## Phase 2: Host-to-Webview Streaming Protocol

### Scope
- Define robust message protocol for streaming audio from extension host to webview.

### Key Changes
- Extend `/Users/antoniomele/Dropbox/github/AgenticSuno/src/ui/PlayerViewProvider.ts` with stream messages:
  - `streamInit`
  - `streamChunk`
  - `streamPause`
  - `streamResume`
  - `streamStop`
  - `streamReset`
  - `streamError`
- Add payload validation and bounded buffering rules on host side.
- Keep legacy `play` URL message path for fallback.

### Acceptance Gate
- Webview receives ordered chunk messages with metadata and no key material.
- Legacy URL playback path remains functional.

## Phase 3: Webview Streaming Playback Engine

### Scope
- Add low-latency chunk playback path while preserving existing URL player fallback.

### Key Changes
- Update `/Users/antoniomele/Dropbox/github/AgenticSuno/media/player.js`:
  - implement streaming queue
  - decode/schedule chunk audio with `AudioContext` pipeline
  - maintain play/pause/resume/stop semantics
  - expose stream state to UI
- Keep existing `<audio>` URL playback path as compatibility fallback.
- If needed, minimally adjust CSP in `/Users/antoniomele/Dropbox/github/AgenticSuno/src/ui/PlayerViewProvider.ts` for chosen playback method.

### Acceptance Gate
- Continuous playback for at least 5 minutes in realtime mode under normal connectivity.
- Pause/Resume/Stop stay deterministic.
- No memory growth beyond expected buffer limits.

## Phase 4: MusicManager Behavior Pivot (Track Queue -> Realtime Session)

### Scope
- Replace generate/extend queue logic with realtime session steering.

### Key Changes
- Refactor `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/MusicManager.ts`:
  - start flow opens/reuses Lyria session
  - mood/intensity mapped to weighted prompts + generation config
  - activity updates steer session (debounced)
  - skip mapped to reset context + prompt/config refresh
  - remove dependency on Suno `audioId`/`extend` semantics in primary path
- Retain fallback mode when Lyria unavailable/missing key.

### Acceptance Gate
- Start or first activity yields audible audio quickly.
- Mood/intensity changes produce session updates without reconnect in normal operation.
- Command behavior matches existing UX expectations.

## Phase 5: Theme/Library Model Migration

### Scope
- Align persistence model with realtime sessions while preserving old data usability.

### Key Changes
- Update project theme storage from “track URL-centric” to “prompt/config preset-centric”.
- Keep reading legacy persisted Suno track entries and allow playback when URLs still valid.
- Update library UI model and behavior in:
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/MusicManager.ts`
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/src/ui/PlayerViewProvider.ts`
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/media/player.js`

### Acceptance Gate
- Existing users do not lose stored theme/library metadata.
- New sessions persist Lyria-compatible theme presets cleanly.

## Phase 6: Configuration, Documentation, and Cleanup

### Scope
- Finalize settings surface, docs, and deprecation messaging.

### Key Changes
- Update `/Users/antoniomele/Dropbox/github/AgenticSuno/package.json`:
  - add `agenticSuno.geminiApiKey`
  - add `agenticSuno.lyriaModel` (default `models/lyria-realtime-exp`)
  - optionally add engine selector for temporary dual-mode transition
- Update docs/specs:
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/README.md`
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/spec/requirements.md`
  - `/Users/antoniomele/Dropbox/github/AgenticSuno/spec/design.md`
- Clearly mark Suno path as fallback/deprecated if still present.

### Acceptance Gate
- Fresh install docs are accurate and end-to-end testable.
- Security posture documented (host-only key usage).

## Phase 7: Verification and Release Readiness

### Scope
- Build confidence through tests, soak checks, and failure-mode validation.

### Test Work
- Unit tests:
  - Lyria message parsing and state machine
  - prompt/config mapping from mood/intensity
  - manager command/state transitions
- Integration tests:
  - mocked websocket server for chunk flow
  - host->webview message protocol
  - fallback path with missing key
- Manual QA:
  - first-start latency
  - long-session stability
  - pause/resume/stop/skip
  - reconnect behavior
  - no-workspace scenario
  - high activity burst steering

### Acceptance Gate
- No high-severity defects.
- All critical flows pass on extension development host.

## 5. File Impact Map

Likely touched files:

- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/MusicManager.ts`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/ui/PlayerViewProvider.ts`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/media/player.js`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/types/index.ts`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/package.json`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/README.md`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/spec/design.md`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/spec/requirements.md`

Likely new files:

- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/lyria/LyriaClient.ts`
- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/lyria/index.ts` (optional)
- `/Users/antoniomele/Dropbox/github/AgenticSuno/src/music/engine/*.ts` (optional abstraction folder)

## 6. Risk Register

1. Audio chunk wire format mismatch.
- Mitigation: implement explicit parser guards and structured logging of unknown server payloads.

2. Playback gap/jitter in webview stream path.
- Mitigation: pre-buffer threshold and scheduling with AudioContext timebase.

3. Reconnect storms or duplicate sessions.
- Mitigation: single-session state machine with explicit reconnect policy and lock.

4. Persisted data incompatibility.
- Mitigation: versioned state migration and legacy read-path support.

5. CSP/security drift.
- Mitigation: keep websocket and key handling in host only; review webview message payloads.

## 7. Definition of Done

1. Lyria is primary generation engine in normal operation.
2. Music starts quickly and stays continuous.
3. Mood and intensity steering is responsive and stable.
4. Legacy fallback remains available.
5. No API key exposure in webview or persisted plaintext settings beyond explicit user config entry.
6. Documentation matches implemented behavior.
