# Cursor Chat Recording

## 2025-02-07: Git Cleanup and Git-LFS Setup

### Request
Clean the git process and use git-lfs for the huge file.

### Analysis
- **Problem**: `.vscode-test/` (~458MB) and `node_modules/` (~91MB) were accidentally committed
- **Root cause**: No `.gitignore` at project root
- **Largest objects in history**: Electron Framework binary (~159MB), VSCode test artifacts
- **Total tracked files before**: 13,118
- **.git size before**: 171MB

### Actions Taken

1. **Created `.gitignore`** with entries for:
   - `node_modules/`
   - `dist/`, `out/`
   - `.vscode-test/`
   - OS files, logs, env files

2. **Removed huge files from git history** using `git-filter-repo`:
   - Purged `.vscode-test/` (VSCode test artifacts, Electron downloads)
   - Purged `node_modules/`
   - History rewritten; origin remote re-added

3. **Set up Git LFS** for future large binary files:
   - Installed via Homebrew
   - Tracking: `*.mp3`, `*.wav`, `*.ogg`, `*.flac`, `*.dylib`, `*.wasm`, `*.node`, `*.woff2`, `*.onnx`, `*.bin`

### Results
- **.git size after**: 492KB (down from 171MB)
- **Tracked files**: 62 (down from 13,118)
- **New commits**: `.gitignore`, `.gitattributes` (git-lfs config)

### Note on Force Push
History was rewritten. If you had already pushed to `origin`, you will need to force push:
```bash
git push --force-with-lease origin main
```
