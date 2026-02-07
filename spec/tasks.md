# Tasks: AgenticSuno

## 1. Project Initialization
- [ ] **init_project**: Initialize VS Code Extension Typescript template. <!-- req: REQ-001 -->
- [ ] **setup_repo**: Configure `.gitignore`, `.eslintrc`, `prettierrc`.

## 2. Core Libraries (Backend)
- [ ] **lib_suno_client**: Implement `SunoClient` class for API interaction. <!-- req: REQ-003, REQ-007 -->
- [ ] **lib_music_manager**: Implement `MusicManager` for state and queue management. <!-- req: REQ-004, REQ-005 -->
- [ ] **lib_agent_listener**: Create `AgentWatcher` interface and `TaskFileWatcher` implementation. <!-- req: REQ-008 -->

## 3. UI/Webview (Frontend)
- [ ] **ui_player_view**: Create `PlayerViewProvider` and Webview HTML template. <!-- req: REQ-010 -->
- [ ] **ui_audio_component**: Implement Audio Player logic (React/Vanilla JS) in Webview. <!-- req: REQ-011 -->
- [ ] **ui_messaging**: Implement message passing between Extension Host and Webview.

## 4. Integration & Logic
- [ ] **int_wiring**: Connect `AgentWatcher` events to `MusicManager` triggers. <!-- req: REQ-003, REQ-006 -->
- [ ] **int_commands**: Implement VS Code commands (`start`, `stop`, `settings`).
- [ ] **int_config**: implementing configuration reading for API key and prompts. <!-- req: REQ-001, REQ-002 -->

## 5. Verification
- [ ] **test_unit**: Unit tests for `SunoClient` and `MusicManager`.
- [ ] **test_e2e**: Manual verification of music generation flow.
