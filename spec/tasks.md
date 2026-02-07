# Implementation Plan

> **Rules:**
> - Two-level hierarchy maximum (Task > Subtask).
> - Sequential order (builds on previous).
> - Traceability: Link back to Req IDs.

---

## Phase 1: Core Foundation

- [ ] **Task 1: Project Setup & Extension Scaffold**
    - [ ] 1.1: Initialize VS Code extension with TypeScript, Webpack bundling
    - [ ] 1.2: Configure ESLint, Prettier, testing framework (Mocha + VS Code test utils)
    - [ ] 1.3: Define extension activation events and contribution points in `package.json`
    - [ ] 1.4: Create folder structure: `src/`, `media/`, `test/`
    - *Traceability:* Foundation for all requirements

- [ ] **Task 2: Configuration System**
    - [ ] 2.1: Define configuration schema in `package.json` (API key, monitored channels, preferences)
    - [ ] 2.2: Implement `ConfigManager` class to read/write settings
    - [ ] 2.3: Implement secure API key storage using `context.secrets`
    - [ ] 2.4: Add setup notification if API key is missing
    - *Traceability:* Implements `REQ-5.1.1`, `REQ-5.1.2`, `REQ-5.2.*`, `PROP-004`

---

## Phase 2: Agent Activity Detection

- [ ] **Task 3: Output Channel Monitor**
    - [ ] 3.1: Implement `OutputChannelMonitor` class that polls/hooks output channels
    - [ ] 3.2: Add regex pattern matching for agent-specific keywords
    - [ ] 3.3: Emit `AgentActivity` events on pattern match
    - [ ] 3.4: Add unit tests for pattern matching
    - *Traceability:* Implements `REQ-1.1.*`

- [ ] **Task 4: Terminal Monitor**
    - [ ] 4.1: Implement `TerminalMonitor` using `onDidStartTerminalShellExecution` and `onDidEndTerminalShellExecution`
    - [ ] 4.2: Detect AI CLI invocations (gemini, claude, cursor)
    - [ ] 4.3: Track command duration and exit status
    - *Traceability:* Implements `REQ-1.2.*`

- [ ] **Task 5: File System Monitor**
    - [ ] 5.1: Implement `FileSystemMonitor` using `createFileSystemWatcher`
    - [ ] 5.2: Watch `.gemini/`, `.cursorrules`, `.claude/` directories
    - [ ] 5.3: Infer activity from artifact modifications
    - *Traceability:* Implements `REQ-1.3.*`

- [ ] **Task 6: Unified Activity Monitor**
    - [ ] 6.1: Create `ActivityMonitor` facade combining all three sources
    - [ ] 6.2: Deduplicate and debounce activity events
    - [ ] 6.3: Track active agent count
    - *Traceability:* Implements `REQ-2.3.1`

---

## Phase 3: Mood Classification

- [ ] **Task 7: Mood Classifier**
    - [ ] 7.1: Implement keyword dictionaries for each mood (epic, tense, focused, triumphant)
    - [ ] 7.2: Implement `classify()` method with weighted scoring
    - [ ] 7.3: Implement `calculateIntensity()` based on activity frequency
    - [ ] 7.4: Add unit tests for edge cases
    - *Traceability:* Implements `REQ-2.1.*`, `REQ-2.2.*`

---

## Phase 4: Suno API Integration

- [ ] **Task 8: Suno API Client**
    - [ ] 8.1: Implement `SunoApiClient` with `generate()` method
    - [ ] 8.2: Implement `extend()` method with `continueAt` support
    - [ ] 8.3: Implement `getTaskStatus()` and polling `waitForCompletion()`
    - [ ] 8.4: Add error handling and retry logic
    - [ ] 8.5: Add mock client for testing (loads bundled sample clips)
    - *Traceability:* Implements `REQ-3.1.*`, `REQ-3.2.*`, `REQ-3.3.1`, `REQ-5.3.*`

- [ ] **Task 9: Project Theme Generator**
    - [ ] 9.1: Implement project metadata reader (README, package.json, repo name)
    - [ ] 9.2: Generate musical theme prompt from project context
    - [ ] 9.3: Store theme in workspace state
    - [ ] 9.4: Add command to regenerate theme
    - *Traceability:* Implements `REQ-3.4.*`

---

## Phase 5: Audio Playback

- [ ] **Task 10: Player Webview**
    - [ ] 10.1: Create webview panel with HTML/CSS player UI
    - [ ] 10.2: Implement Web Audio API playback with crossfade support
    - [ ] 10.3: Implement visualization (canvas-based waveform/spectrum)
    - [ ] 10.4: Implement postMessage communication with extension host
    - [ ] 10.5: Style with premium dark design (glassmorphism, gradients)
    - *Traceability:* Implements `REQ-4.1.*`, `REQ-6.1.*`

- [ ] **Task 11: Audio Manager**
    - [ ] 11.1: Implement `AudioManager` class bridging webview and orchestrator
    - [ ] 11.2: Implement clip queue and preloading
    - [ ] 11.3: Implement volume persistence
    - [ ] 11.4: Implement gapless transition logic
    - *Traceability:* Implements `REQ-4.2.*`, `REQ-4.3.*`

- [ ] **Task 12: Clip Cache**
    - [ ] 12.1: Implement LRU cache for downloaded audio files
    - [ ] 12.2: Store clips in extension's global storage path
    - [ ] 12.3: Implement cache eviction (max 20 clips / 200MB)
    - *Traceability:* Implements `PROP-005`

---

## Phase 6: Orchestration

- [ ] **Task 13: Music Orchestrator**
    - [ ] 13.1: Implement main control loop: activity → classify → generate/extend
    - [ ] 13.2: Implement extension scheduling (trigger at <15s remaining)
    - [ ] 13.3: Implement mood transition handling
    - [ ] 13.4: Implement multi-agent layer orchestration
    - [ ] 13.5: Handle graceful degradation on API errors
    - *Traceability:* Implements `REQ-3.2.*`, `REQ-3.3.*`, `REQ-2.3.2`, `PROP-003`

---

## Phase 7: UI & Commands

- [ ] **Task 14: Status Bar Item**
    - [ ] 14.1: Create status bar item with state-based icons
    - [ ] 14.2: Implement click to toggle play/pause
    - [ ] 14.3: Add tooltip with current mood and track info
    - *Traceability:* Implements `REQ-6.2.*`

- [ ] **Task 15: Commands**
    - [ ] 15.1: Register commands: Play, Pause, Stop, Skip, Show Player
    - [ ] 15.2: Add keyboard shortcuts (mute toggle)
    - [ ] 15.3: Add command palette integration
    - *Traceability:* Implements `REQ-4.2.3`, `REQ-4.3.3`

- [ ] **Task 16: Notifications**
    - [ ] 16.1: Implement setup notification for missing API key
    - [ ] 16.2: Implement theme generation notification
    - [ ] 16.3: Implement error notifications (non-blocking)
    - *Traceability:* Implements `REQ-6.3.*`, `REQ-5.1.2`

---

## Phase 8: Testing & Polish

- [ ] **Task 17: Unit Tests**
    - [ ] 17.1: Test ActivityMonitor pattern matching
    - [ ] 17.2: Test MoodClassifier scoring
    - [ ] 17.3: Test SunoApiClient request building
    - [ ] 17.4: Test ConfigManager

- [ ] **Task 18: Integration Tests**
    - [ ] 18.1: Test full flow: simulated activity → music generation → playback
    - [ ] 18.2: Test mock mode end-to-end
    - [ ] 18.3: Test error recovery scenarios

- [ ] **Task 19: Documentation**
    - [ ] 19.1: Write README with setup instructions
    - [ ] 19.2: Document configuration options
    - [ ] 19.3: Add screenshots and demo GIF
    - [ ] 19.4: Write CHANGELOG

- [ ] **Task 20: Final Review**
    - [ ] 20.1: Performance profiling (activation time, memory usage)
    - [ ] 20.2: Accessibility review
    - [ ] 20.3: Security audit (CSP, secret storage)
    - [ ] 20.4: Package and test VSIX
