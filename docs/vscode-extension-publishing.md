# AgenticSuno VS Code Extension Publishing Guide

This runbook covers:
- First-time publishing to the VS Code Marketplace.
- Republishing when the extension is updated.
- Automated release scripts included in this repository.

It is based on the official VS Code documentation:
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Manage Publishers](https://marketplace.visualstudio.com/manage/publishers/)

## 1. What Is Automated vs Manual

### Automated by repository scripts
- Marketplace readiness checks.
- Optional test execution.
- Prepublish build execution.
- VSIX packaging.
- Direct Marketplace publish (when `VSCE_PAT` is set).

### Manual (cannot be fully automated)
- Creating Azure DevOps PAT with proper Marketplace permissions.
- Creating the Marketplace publisher account (first time only).
- PAT rotation/revocation when credentials change.

## 2. Prerequisites

1. Node.js and npm installed.
2. Repository dependencies installed:
   - `npm install`
3. Marketplace credentials:
   - Azure DevOps Personal Access Token (PAT) with:
     - Marketplace scope: `Manage`
     - Organization scope: `All accessible organizations`
4. A created Marketplace publisher ID (first release only).

## 3. Required Repository State

The repository now includes release metadata and automation scaffolding:
- `package.json` includes:
  - `publisher`
  - `icon`
  - `license`
  - release scripts:
    - `release:check`
    - `release:publish`
- `CHANGELOG.md`
- `LICENSE`
- `.vscodeignore`
- scripts:
  - `scripts/check-marketplace-readiness.sh`
  - `scripts/publish-extension.sh`

## 4. First-Time Publish (Initial Marketplace Release)

### Step 1: Create PAT and Publisher
1. Create PAT in Azure DevOps with Marketplace `Manage` scope.
2. Create publisher in Marketplace:
   - [Manage Publishers](https://marketplace.visualstudio.com/manage/publishers/)
3. Ensure `package.json` `publisher` exactly matches that publisher ID.

### Step 2: Export release environment
1. Copy and load release env file:
   ```bash
   cp .env.release.example .env.release
   set -a && source .env.release && set +a
   ```
2. Set real values in `.env.release`:
   - `VSCE_PAT`
   - optional `VSCE_PUBLISHER` guard

### Step 3: Run readiness checks
```bash
npm run release:check -- --check-package
```

This checks:
- Required manifest fields (`name`, `displayName`, `publisher`, `version`, `engines.vscode`, `description`, `categories`).
- Recommended metadata (`icon`, `repository`, `license`).
- Keywords max count (<= 30).
- Required files (`README.md`, `CHANGELOG.md`, `LICENSE`, `.vscodeignore`).
- Listing policy for insecure `http://` links in `README.md` and `CHANGELOG.md`.
- VSIX package build sanity.

### Step 4: Publish (recommended dry-run first)
Dry-run:
```bash
npm run release:publish -- --bump patch --dry-run --allow-dirty
```

Real publish:
```bash
npm run release:publish -- --bump patch --allow-dirty
```

Notes:
- `--allow-dirty` bypasses clean-working-tree enforcement. Remove it when releasing from a clean release commit.
- Real publish requires `VSCE_PAT`.

### Step 5: Verify after publish
1. Open Marketplace listing and confirm:
   - Correct version
   - README rendering
   - Icon and metadata
2. Install/update extension in VS Code to validate runtime behavior.

## 5. Republishing (Subsequent Releases)

1. Update extension code.
2. Update `CHANGELOG.md`.
3. Choose version strategy explicitly:
   - `--bump patch|minor|major`
   - or `--version x.y.z`
4. Run dry-run:
   ```bash
   npm run release:publish -- --bump patch --dry-run
   ```
5. Run real publish:
   ```bash
   npm run release:publish -- --bump patch
   ```
6. Verify Marketplace update and local install/update.

## 6. Release Script Reference

### `scripts/check-marketplace-readiness.sh`
Usage:
```bash
bash ./scripts/check-marketplace-readiness.sh [--check-package] [--quiet]
```

Exit behavior:
- `0`: no blocking errors
- non-zero: one or more blocking errors

### `scripts/publish-extension.sh`
Usage:
```bash
bash ./scripts/publish-extension.sh \
  (--bump patch|minor|major | --version x.y.z[-tag]) \
  [--pre-release] \
  [--target <platform>] \
  [--dry-run] \
  [--skip-tests] \
  [--allow-dirty]
```

Behavior:
1. Runs readiness checks with packaging validation.
2. Runs tests unless `--skip-tests`.
3. Runs `npm run vscode:prepublish`.
4. Packages VSIX into `.release-artifacts/`.
5. Publishes with `vsce publish` unless `--dry-run`.

Environment contract:
- `VSCE_PAT` is required for real publish.
- `VSCE_PUBLISHER` is optional and used as a publisher safety check.

## 7. Optional Publish Modes

### Pre-release publish
```bash
npm run release:publish -- --version 0.2.0-beta.1 --pre-release
```

### Platform-specific publish
```bash
npm run release:publish -- --bump minor --target linux-x64
```

## 8. Common Failures and Fixes

1. `401` / `403` auth errors:
   - PAT scope is wrong or expired.
   - Fix PAT with Marketplace `Manage` and `All accessible organizations`.
2. Publisher mismatch:
   - `package.json` `publisher` does not match intended publisher.
   - Align `package.json` and optional `VSCE_PUBLISHER`.
3. Manifest or listing validation failures:
   - Missing required fields/files.
   - Too many keywords (>30).
   - Insecure `http://` content links.
4. Dirty tree block:
   - Commit/stash changes, or use `--allow-dirty` intentionally.

## 9. Suggested CI Adoption

Use the same script in CI for consistency:
1. Store `VSCE_PAT` in CI secret manager.
2. Trigger on release tags.
3. Run:
   ```bash
   npm ci
   npm run release:publish -- --version "$RELEASE_VERSION" --skip-tests
   ```
4. Keep tests in separate CI jobs as release gates.
