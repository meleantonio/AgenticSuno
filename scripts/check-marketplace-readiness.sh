#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

RUN_PACKAGE_CHECK=0
QUIET=0

if [[ -x "${REPO_ROOT}/node_modules/.bin/vsce" ]]; then
    VSCE_CMD=("${REPO_ROOT}/node_modules/.bin/vsce")
else
    VSCE_CMD=(npx --yes @vscode/vsce)
fi

usage() {
    cat <<'EOF'
Usage: scripts/check-marketplace-readiness.sh [options]

Checks whether this VS Code extension is ready to publish.

Options:
  --check-package   Build a VSIX package with vsce as part of validation
  --quiet           Suppress non-error output
  -h, --help        Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check-package)
            RUN_PACKAGE_CHECK=1
            shift
            ;;
        --quiet)
            QUIET=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

errors=0
warnings=0

say() {
    if [[ "${QUIET}" -eq 0 ]]; then
        printf '%s\n' "$1"
    fi
}

ok() {
    say "OK    $1"
}

warn() {
    printf 'WARN  %s\n' "$1" >&2
    warnings=$((warnings + 1))
}

fail() {
    printf 'ERROR %s\n' "$1" >&2
    errors=$((errors + 1))
}

if [[ ! -f "package.json" ]]; then
    fail "package.json is missing from repository root."
else
    ok "Found package.json."
fi

manifest_report="$(
    node <<'NODE'
const fs = require("fs");

const errors = [];
const warnings = [];
const infos = [];

let pkg;
try {
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
} catch (error) {
    console.log(`E:Unable to parse package.json: ${error.message}`);
    process.exit(0);
}

const requiredFields = ["name", "displayName", "publisher", "version", "description"];
for (const field of requiredFields) {
    const value = pkg[field];
    if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`Missing required package.json field "${field}".`);
    }
}

if (!pkg.engines || typeof pkg.engines.vscode !== "string" || pkg.engines.vscode.trim().length === 0) {
    errors.push('Missing required package.json field "engines.vscode".');
}

if (!Array.isArray(pkg.categories) || pkg.categories.length === 0) {
    errors.push('Missing required package.json field "categories" (non-empty array).');
}

if (pkg.keywords !== undefined) {
    if (!Array.isArray(pkg.keywords)) {
        errors.push('package.json field "keywords" must be an array when present.');
    } else if (pkg.keywords.length > 30) {
        errors.push(`package.json field "keywords" has ${pkg.keywords.length} entries (max 30).`);
    }
}

for (const field of ["icon", "repository", "license"]) {
    if (pkg[field] === undefined || pkg[field] === null || String(pkg[field]).trim().length === 0) {
        warnings.push(`Recommended package.json field "${field}" is missing.`);
    }
}

if (typeof pkg.icon === "string" && pkg.icon.trim().length > 0) {
    if (!pkg.icon.toLowerCase().endsWith(".png")) {
        warnings.push('package.json field "icon" should point to a PNG file for Marketplace compatibility.');
    }
}

if (typeof pkg.publisher === "string") {
    const normalized = pkg.publisher.trim().toLowerCase();
    if (normalized === "your-publisher-id" || normalized.includes("replace") || normalized.includes("todo")) {
        warnings.push('package.json "publisher" looks like a placeholder; set it to your real Marketplace publisher ID.');
    }
}

infos.push(`name=${pkg.name ?? "<missing>"}`);
infos.push(`publisher=${pkg.publisher ?? "<missing>"}`);
infos.push(`version=${pkg.version ?? "<missing>"}`);
infos.push(`engines.vscode=${pkg.engines?.vscode ?? "<missing>"}`);

for (const error of errors) {
    console.log(`E:${error}`);
}
for (const warning of warnings) {
    console.log(`W:${warning}`);
}
for (const info of infos) {
    console.log(`I:${info}`);
}
NODE
)"

while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    case "${line}" in
        E:*)
            fail "${line#E:}"
            ;;
        W:*)
            warn "${line#W:}"
            ;;
        I:*)
            say "INFO  ${line#I:}"
            ;;
        *)
            say "${line}"
            ;;
    esac
done <<< "${manifest_report}"

for file in README.md CHANGELOG.md LICENSE .vscodeignore; do
    if [[ -f "${file}" ]]; then
        ok "Found ${file}."
    else
        fail "Missing required file ${file}."
    fi
done

if [[ -f package.json ]]; then
    icon_path="$(node -e 'const pkg=require("./package.json"); process.stdout.write(typeof pkg.icon==="string" ? pkg.icon : "");')"
    if [[ -n "${icon_path}" ]]; then
        if [[ -f "${icon_path}" ]]; then
            ok "Icon file exists at ${icon_path}."
        else
            fail "Icon file declared in package.json was not found at ${icon_path}."
        fi
    fi
fi

for listing_file in README.md CHANGELOG.md; do
    if [[ -f "${listing_file}" ]]; then
        if rg -n 'http://' "${listing_file}" >/dev/null; then
            fail "${listing_file} contains insecure http:// links. Use https:// for Marketplace content."
            rg -n 'http://' "${listing_file}" >&2 || true
        else
            ok "${listing_file} does not contain insecure http:// links."
        fi

        if rg -n 'https?://[^") ]+\.svg([") ]|$)' "${listing_file}" >/dev/null; then
            warn "${listing_file} contains external SVG references. Marketplace blocks SVG assets in most listing contexts."
        fi
    fi
done

if [[ "${RUN_PACKAGE_CHECK}" -eq 1 ]]; then
    if [[ "${QUIET}" -eq 0 ]]; then
        say "Running package validation with @vscode/vsce..."
    fi
    tmp_vsix="$(mktemp /tmp/agentic-suno-package-check-XXXXXX.vsix)"
    tmp_log="$(mktemp /tmp/agentic-suno-package-check-log-XXXXXX.txt)"

    if "${VSCE_CMD[@]}" package --out "${tmp_vsix}" >"${tmp_log}" 2>&1; then
        ok "VSIX package build succeeded."
    else
        fail "VSIX package build failed."
        sed -n '1,200p' "${tmp_log}" >&2 || true
    fi

    rm -f "${tmp_vsix}" "${tmp_log}"
fi

if [[ "${errors}" -gt 0 ]]; then
    echo
    echo "Readiness check failed with ${errors} error(s) and ${warnings} warning(s)." >&2
    exit 1
fi

if [[ "${QUIET}" -eq 0 ]]; then
    echo
    echo "Readiness check passed with ${warnings} warning(s)."
fi
