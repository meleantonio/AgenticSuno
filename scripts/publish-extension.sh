#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/check-marketplace-readiness.sh"
cd "${REPO_ROOT}"

BUMP_KIND=""
EXACT_VERSION=""
PRE_RELEASE=0
TARGET=""
DRY_RUN=0
SKIP_TESTS=0
ALLOW_DIRTY=0

if [[ -x "${REPO_ROOT}/node_modules/.bin/vsce" ]]; then
    VSCE_CMD=("${REPO_ROOT}/node_modules/.bin/vsce")
else
    VSCE_CMD=(npx --yes @vscode/vsce)
fi

usage() {
    cat <<'EOF'
Usage: scripts/publish-extension.sh [options]

Automates VS Code extension release flow:
preflight checks -> optional tests -> build -> package -> publish.

Required (choose one):
  --bump patch|minor|major   Bump semantic version via vsce publish
  --version x.y.z[-tag]      Publish an explicit version

Optional:
  --pre-release              Publish as pre-release
  --target <platform>        Publish/package for a specific platform target
  --dry-run                  Run full flow except final Marketplace publish
  --skip-tests               Skip npm test
  --allow-dirty              Allow publishing from a dirty git working tree
  -h, --help                 Show this help text
EOF
}

fail() {
    echo "ERROR $1" >&2
    exit 1
}

info() {
    echo "INFO  $1"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bump)
            [[ $# -lt 2 ]] && fail "--bump requires one value: patch|minor|major"
            BUMP_KIND="$2"
            shift 2
            ;;
        --version)
            [[ $# -lt 2 ]] && fail "--version requires one value like 1.2.3"
            EXACT_VERSION="$2"
            shift 2
            ;;
        --pre-release)
            PRE_RELEASE=1
            shift
            ;;
        --target)
            [[ $# -lt 2 ]] && fail "--target requires one value (example: linux-x64)"
            TARGET="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=1
            shift
            ;;
        --allow-dirty)
            ALLOW_DIRTY=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown option: $1"
            ;;
    esac
done

if [[ ! -x "${CHECK_SCRIPT}" ]]; then
    fail "Missing executable check script at ${CHECK_SCRIPT}"
fi

if [[ -n "${BUMP_KIND}" && -n "${EXACT_VERSION}" ]]; then
    fail "Use either --bump or --version, not both."
fi

if [[ -z "${BUMP_KIND}" && -z "${EXACT_VERSION}" ]]; then
    fail "One version option is required: --bump patch|minor|major OR --version x.y.z."
fi

if [[ -n "${BUMP_KIND}" ]]; then
    case "${BUMP_KIND}" in
        patch|minor|major) ;;
        *)
            fail "--bump must be one of: patch, minor, major."
            ;;
    esac
fi

if [[ -n "${EXACT_VERSION}" ]]; then
    if [[ ! "${EXACT_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
        fail "--version must follow semantic version format, for example 1.2.3 or 1.2.3-beta.1."
    fi
fi

if [[ "${ALLOW_DIRTY}" -eq 0 ]]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [[ -n "$(git status --porcelain)" ]]; then
            fail "Working tree is dirty. Commit/stash changes or rerun with --allow-dirty."
        fi
    fi
fi

current_version="$(node -e 'const pkg=require("./package.json"); process.stdout.write(pkg.version || "");')"
publisher_from_manifest="$(node -e 'const pkg=require("./package.json"); process.stdout.write(pkg.publisher || "");')"
extension_name="$(node -e 'const pkg=require("./package.json"); process.stdout.write(pkg.name || "extension");')"

[[ -z "${current_version}" ]] && fail "Unable to read package.json version."
[[ -z "${publisher_from_manifest}" ]] && fail "package.json publisher is empty. Set it before publishing."

if [[ -n "${VSCE_PUBLISHER:-}" && "${VSCE_PUBLISHER}" != "${publisher_from_manifest}" ]]; then
    fail "VSCE_PUBLISHER (${VSCE_PUBLISHER}) does not match package.json publisher (${publisher_from_manifest})."
fi

target_version=""
if [[ -n "${EXACT_VERSION}" ]]; then
    target_version="${EXACT_VERSION}"
else
    target_version="$(
        node - "${current_version}" "${BUMP_KIND}" <<'NODE'
const current = process.argv[2];
const bump = process.argv[3];
const match = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
if (!match) {
    console.error(`Current version is not semver-compatible: ${current}`);
    process.exit(1);
}
let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
} else if (bump === "minor") {
    minor += 1;
    patch = 0;
} else if (bump === "patch") {
    patch += 1;
} else {
    console.error(`Unsupported bump kind: ${bump}`);
    process.exit(1);
}
process.stdout.write(`${major}.${minor}.${patch}`);
NODE
    )"
fi

info "Current version: ${current_version}"
info "Planned publish version: ${target_version}"
info "Publisher: ${publisher_from_manifest}"

info "Running marketplace readiness checks..."
"${CHECK_SCRIPT}" --check-package

if [[ "${SKIP_TESTS}" -eq 0 ]]; then
    info "Running test suite..."
    npm test
else
    info "Skipping tests (--skip-tests)."
fi

info "Running prepublish build (npm run vscode:prepublish)..."
npm run vscode:prepublish

artifacts_dir="${REPO_ROOT}/.release-artifacts"
mkdir -p "${artifacts_dir}"

target_suffix=""
if [[ -n "${TARGET}" ]]; then
    target_suffix="-${TARGET}"
fi

package_path="${artifacts_dir}/${extension_name}-${current_version}${target_suffix}.vsix"
package_cmd=("${VSCE_CMD[@]}" package --out "${package_path}")
if [[ "${PRE_RELEASE}" -eq 1 ]]; then
    package_cmd+=(--pre-release)
fi
if [[ -n "${TARGET}" ]]; then
    package_cmd+=(--target "${TARGET}")
fi

info "Packaging VSIX artifact at ${package_path}..."
"${package_cmd[@]}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "Dry run complete. Publish step skipped."
    info "To publish for real, rerun without --dry-run and ensure VSCE_PAT is exported."
    exit 0
fi

if [[ -z "${VSCE_PAT:-}" ]]; then
    fail "VSCE_PAT is required for non-dry-run publish."
fi

publish_cmd=("${VSCE_CMD[@]}" publish)
if [[ -n "${BUMP_KIND}" ]]; then
    publish_cmd+=("${BUMP_KIND}")
else
    publish_cmd+=("${EXACT_VERSION}")
fi
if [[ "${PRE_RELEASE}" -eq 1 ]]; then
    publish_cmd+=(--pre-release)
fi
if [[ -n "${TARGET}" ]]; then
    publish_cmd+=(--target "${TARGET}")
fi

publish_log="$(mktemp /tmp/agentic-suno-publish-log-XXXXXX.txt)"
info "Publishing to VS Code Marketplace..."
if "${publish_cmd[@]}" >"${publish_log}" 2>&1; then
    cat "${publish_log}"
    rm -f "${publish_log}"
    info "Publish completed successfully."
    exit 0
fi

cat "${publish_log}" >&2
echo >&2
echo "Publish failed. Common causes and checks:" >&2
if grep -Eiq '401|403|forbidden|unauthorized' "${publish_log}"; then
    echo "- Authentication/authorization issue: verify VSCE_PAT scope is Marketplace (Manage) and org scope is All accessible organizations." >&2
fi
if grep -Eiq 'publisher|not found|cannot find publisher|does not match' "${publish_log}"; then
    echo "- Publisher mismatch: confirm package.json publisher and VSCE_PUBLISHER (if set) are correct." >&2
fi
if grep -Eiq 'keywords|icon|markdown|badge|svg|http://' "${publish_log}"; then
    echo "- Metadata issue: fix package.json metadata and listing assets (icon, links, badges) then retry." >&2
fi
echo "- Re-run release preflight: npm run release:check -- --check-package" >&2
rm -f "${publish_log}"
exit 1
