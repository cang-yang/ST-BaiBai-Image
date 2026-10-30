# Preset Material Flow Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make preset task instructions operate on actual materials in a predictable sequence without automatic duplicate material injection.

**Architecture:** Optional entry placement divides preset messages into before-data and after-data phases. Render variables in execution order and track actual built-in material references, excluding local variable overrides. The prompt builder retains unreferenced automatic materials, inserts private worldbooks using existing anchors, then appends after-data entries and the selected submission reminder.

**Tech Stack:** TypeScript, Vue, Vitest, existing Vite build.

## Global Constraints

- Preserve old entry placement by default, settings, keys, workflows, and author drawing rules.
- Never execute terminal commands, host macros, or scripts from presets.
- Do not reproduce filter-bypass packaging or publish long reasoning.
- Only presets using after-data placement require export schema v3; older v1/v2 imports remain supported.
- Generic capabilities, no model-name or preset-name branches.

### Task 1: Model and Rendering

Files: `src/presets/model.ts`, `src/presets/render.ts`, `src/presets/model.test.ts`.

- [x] Test round-trip of `placement: 'after_data'`, missing placement defaults, and invalid placement rejection.
- [x] Test actual before/after ordering, sequential variables, alias material references, disabled entries and shadowed variables.
- [x] Run `npx vitest run src/presets/model.test.ts` and observe RED.
- [x] Add optional `placement?: 'before_data' | 'after_data'`, v3 export/import, and renderer `beforeData`, `afterData`, `usedMaterials`.
- [x] Rerun tests and confirm GREEN.

### Task 2: Prompt Assembly and UI

Files: `src/autoTag/prompt.ts`, `src/autoTag/prompt.test.ts`, `src/pages/settings/ImagePresetSection.vue`, `src/pages/settings/ImagePresetSection.test.ts`.

- [x] Test after-data entries follow actual story, final mode reminder follows entries, and automatic story/library/task blocks are omitted only when rendered via built-in variables.
- [x] Test unreferenced materials remain, including empty-library state and missing/disabled/local-shadow variables.
- [x] Run focused tests and observe RED.
- [x] Render before-data entries at the existing location, retain unreferenced data, inject private worldbooks before appending after-data entries.
- [x] Add placement selector under existing advanced entry settings and a suffix for after-data entries in the existing picker. Do not add a content directory.
- [x] Test export/save preservation and UI labels; rerun focused tests.

### Task 3: Deliverable Preset and Verification

Files: workspace `work/adapt-kunlun-material-flow.mjs`, `outputs/MOSS-Kunlun-Material-Flow/`, repo `docs/image-presets.md`.

- [x] Generate a separate v4 preset from v3; preserve rules/output/format/lettering/composition and retain task, material, state, and format checks.
- [x] Move actual material/format confirmation and execution after data, remove false assertions of already loading unseen data.
- [x] Verify imports, rules unchanged, before/after sequence, counts, no duplicated sentinel data and selected JSON/tool protocol.
- [x] Run full Vitest suite, typecheck, build and browser desktop/mobile check.
- [ ] Back up installed plugin assets, update local plugin only, preserve settings; commit and push existing feature branch.
- [ ] Deliver one importable preset and exact user steps. State whether live API/image generation was verified.

## Verification Evidence

- 90 Vitest files passed: 1212 tests passed, 3 skipped.
- Typecheck and production build passed; existing bundle-size warning remains.
- Six complete v4 prompt-builder cases passed, including text/tool submission and three count ranges.
- Actual local SillyTavern import, edit, save, and preview passed. Saved 8 before-data and 6 after-data entries; original active preset unchanged.
- Desktop 1280x1000 and mobile 390x844 screenshots inspected.
- One real preset test via configured Canggo channel failed at network connection: HTTP 502, upstream `connect ETIMEDOUT` to port 443. No model response or image quality validation was obtained. No cloud image request was made.
