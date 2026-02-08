# Persisted Songs & Project Theme – Design

Songs generated in a session stay available for playing later and in future sessions. The **first song ever** for the repo is derived from specs, README, and/or repo name; if no info is available, the player starts with mock music. That first song is always available to play. Launching agents continues to trigger new music and add it to the library.

---

## 1. Where to persist

| Storage | Use case |
|--------|----------|
| **`context.workspaceState`** | Per-workspace; survives restarts. Primary store for song library and project theme. Each repo has its own tracks. |
| **`context.globalState`** | Optional: cross-workspace “recent tracks” or user preferences. |
| **Workspace folder** | Optional: `.agentic-suno/` or `.vscode/agentic-suno/` for metadata (and optionally downloaded audio). Add to `.gitignore` if storing binaries. |

Recommendation: Start with **workspaceState** only; add a folder later if we want portable/visible library files.

---

## 2. What to persist

**Track payload (library entry)**  
`id`, `audio_url`, `title`, `mood`, `generatedAt`, optional `prompt`, `style`.

Suno CDN URLs may expire. Options:

- **A)** Store URL + metadata only; show “Unavailable” or “Regenerate” when playback fails.
- **B)** Download MP3 to workspace (e.g. `.agentic-suno/tracks/<id>.mp3`); persistent but uses disk and Git LFS/gitignore.
- **C)** For **project theme** only: store the **prompt** (and style); cache the resulting URL in workspaceState; when URL fails, regenerate from prompt when user chooses “Play project theme”.

**Project theme (first song)**  
Single object: `{ track?: MusicTrack, prompt: string, style?: string, generatedAt?: number }`.

- If `track` exists and URL works → play it.
- Else if we have `prompt` → regenerate and replace; then play.
- Else no theme yet → offer mock when user hits “Play”.

---

## 3. First song ever (project theme)

**When**  
First use in this workspace: no `workspaceState.get('agenticSuno.projectTheme')` (or similar key).

**Prompt derivation (priority)**  
1. **Repo name**: `workspaceFolders[0].name` → e.g. “Instrumental theme for a project named AgenticSuno, ambient, modern.”
2. **README.md**: First ~500 chars (or first paragraph), sanitized.
3. **spec/**: If present, read `spec/intent.md` or `spec/requirements.md` or `spec/design.md` (first N chars) and blend into prompt.
4. **package.json**: `name`, `description` for project context.

**Fallback**  
If no workspace or no usable text: do **not** generate a real track; treat as “no project theme”. When user hits “Play” with no agent activity, use **mock music** (current SoundHelix demos).

**Persistence**  
Save project theme (track + prompt) in workspaceState; optionally also `.agentic-suno/project-theme.json`. The first song is then always available (e.g. “Play project theme” in the player).

---

## 4. Session vs future sessions

- **Current session**: Keep existing in-memory queue and moodCache. On each successful generation (or extend), append track to library and call `persistLibrary()` (and on deactivate).
- **Future sessions**: On activate, `loadPersistedLibrary()` from workspaceState. Show “Previous tracks” / “Library” in player; user can pick any past track. Cap library size (e.g. last 50 tracks per workspace).

---

## 5. Player UX when idle

- **Before any agent activity**: If project theme exists → “Play project theme” / “Play default”; else “Play mock music” or “Waiting for agents…”.
- **Play project theme**: If we have a valid project-theme track (or can regenerate from prompt), play it; else play mock.
- **Library**: Sidebar section “Your tracks” / “Session & history” (project theme + recent tracks); click to play.
- Agent activity continues to trigger new generations and add new tracks to the library.

---

## 6. Implementation hooks

**Extension**  
- Pass `context` (ExtensionContext) into `MusicManager` (or a small `SongLibrary` that uses `context.workspaceState`).
- On activate: `musicManager.loadPersistedLibrary()`, `musicManager.ensureProjectTheme()` (async, after first paint or lazy on first “Play”).

**MusicManager**  
- New: `getProjectTheme()`, `setProjectTheme(track, prompt)`, `getLibrary()`, `addToLibrary(track)`, `persistLibrary()`.
- After each successful generation (and extend): `addToLibrary(track)` and `persistLibrary()`.
- “First song” flow: if no project theme, `deriveProjectThemePrompt()` (using `vscode.workspace` and `fs`), then `client.generate(...)`, then `setProjectTheme(result.tracks[0], prompt)` and persist.

**PlayerViewProvider / media/player.js**  
- New UI/messages: “Play project theme”, “Library” list.
- When user selects “Play project theme”, extension calls `musicManager.playProjectTheme()` (plays stored track or generates then plays).

---

## 7. Edge cases

| Case | Behavior |
|------|----------|
| No workspace | Only mock music; no project theme. |
| Suno API key missing | Use mock for project theme (e.g. SoundHelix as default). |
| URL expiry | On play from library, if fetch fails → mark unavailable, offer “Regenerate” (project theme: use stored prompt; others: “Regenerate in same mood” with generic prompt). |
| First launch ever | Lazy-create project theme on first “Play” (or when user opens player) so activation is not blocked by file I/O or API. |

---

## Summary

1. Songs available later and in future sessions via **workspaceState** (and optional folder).
2. First song from repo/specs/README with **mock fallback** when no info.
3. First song always playable (“Play project theme”).
4. Agent launches still trigger new music and add to the library.
