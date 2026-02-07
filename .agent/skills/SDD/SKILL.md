# Spec-Driven Development (SDD) - Agent Skill

## Description
Implements the Spec-Driven Development lifecycle (Intent -> Requirements -> Design -> Tasks -> Build). Use this skill when the user wants to build a new feature or project using the structured SDD framework extracted from AWS best practices.

## Usage
<!-- Run via: `openclaw run sdd <command>` -->
Run as an agent skill using the command `sdd <command>`



## Commands

### `init`
**Description:** Scaffolds the SDD folder structure (`spec/`, `steering/`) and template files.
**Action:**
1. Check if `spec/` exists.
2. If not, create `spec/` and `steering/`.
3. Create `spec/intent.md` (blank).
4. Copy templates for `requirements.md`, `design.md`, `tasks.md`.

### `reqs`
**Description:** Generates EARS requirements from `spec/intent.md`.
**Action:**
1. Read `spec/intent.md`.
2. Read `steering/*.md` (for context).
3. LLM Task: "Convert this intent into EARS requirements. Output markdown."
4. Write to `spec/requirements.md`.

### `design`
**Description:** Generates technical design from requirements.
**Action:**
1. Read `spec/requirements.md`.
2. Read `steering/*.md`.
3. LLM Task: "Create a technical design for these requirements. Check for circular dependencies. Be ruthless with editing."
4. Write to `spec/design.md`.

### `tasks`
**Description:** Generates implementation tasks from design.
**Action:**
1. Read `spec/design.md`.
2. Read `spec/requirements.md` (for traceability).
3. LLM Task: "Create a sequential task list. Max 2 levels deep. Link to Req IDs."
4. Write to `spec/tasks.md`.

### `status`
**Description:** Checks the current state of the spec files.
**Action:**
1. List files in `spec/`.
2. check for `[ ]` vs `[x]` in `tasks.md`.
