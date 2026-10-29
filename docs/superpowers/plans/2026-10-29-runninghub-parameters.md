# RunningHub Parameter Editor Implementation Plan

> **For agentic workers:** Execute this approved plan inline, task by task,
> using test-driven-development and verification-before-completion.

**Goal:** Make imported workflow controls understandable without removing advanced control.

**Architecture:** Add a pure workflow-parameter model, preserve its optional
metadata/baseline through existing import/export, and render it in one scoped
Vue component inside the existing RunningHub panel.

**Tech Stack:** TypeScript, Vue, Vitest, existing BbiSelect/Icon and Playwright CLI.

## Global Constraints

No paid API calls, topology changes, invented dropdown inventories or unrelated
settings changes. Preserve all existing scalar override submission behavior.

### Task 1: Parameter Model And Persistence

- [x] Add failing tests to `src/backends/workflowParameters.test.ts` for generic
  controls, rename/pin, typed edits, safe bindings and scalar-only resets.
- [x] Implement `src/backends/workflowParameters.ts`. Export field definitions,
  `workflowParameters`, `editWorkflowParameter`, `resetWorkflowParameters`,
  `normalizeParameterControls` and `parameterSourceOptions`.
- [x] Persist `parameterControls` and `initialWorkflow` in
  `src/backends/runninghubConfig.ts` and import/export them in
  `src/backends/runninghubWorkflow.ts`. Add round-trip regression tests.
- [x] Run `npm test -- src/backends/workflowParameters.test.ts src/backends/runninghubWorkflow.test.ts`.

### Task 2: Editor

- [x] Add `src/pages/backend/panels/RunningHubParameters.vue`, receiving the
  active RunningHubPreset and emitting workflow updates. Render common
  booleans/pinned fields and grouped searchable advanced fields from the same model.
- [x] Replace the old flat parameter list in `RunningHubPanel.vue` while
  retaining reference-image upload and all other panel actions.
- [x] Add modified/reset state, explicit source editing and typed controls.
- [x] Run `npm run typecheck` and `npm run build`.

### Task 3: Local Verification And Release

- [x] Verify actual workflow import and generic fixtures in browser, including
  desktop/mobile, booleans, search, rename/pin, reset and export persistence. No cloud runs.
- [x] Run affected backend/state/generation tests and inspect the diff.
- [x] Bump release version, build, back up and update local extension files,
  preserve existing workflows and add the new MOSS copy if necessary.
- [ ] Record verification, commit and push the existing fork feature branch.

## Verification Record

- Version: 0.3.19. Full suite: 88 files, 1193 passed, 3 existing skips.
- Typecheck and production build passed. Existing bundle-size warning remains.
- Real SillyTavern at `http://127.0.0.1:8000/`: imported existing API workflow
  and an unrelated custom-node fixture using the UI.
- Verified boolean type, arbitrary enum choices, decimal edits, rename/pin,
  common/advanced synchronization, invalid empty-number rejection, search,
  reset cancel/confirm, file export and settings persistence after reload.
- Verified original selector branches and links unchanged. Global reset
  restored the original boolean, step count and `%width%` binding.
- Desktop 1280x1000 and mobile 390x844 checked; no editor horizontal overflow.
  Screenshots are outside the repository in workspace `output/playwright/`.
- Export included display controls/defaults but no channel credentials.
- Removed the temporary generic workflow. Preserved the original local workflow,
  retained an added real 8/50 workflow copy and restored its parameter values.
- No paid cloud requests, preset changes, manga layout changes or API Key edits.
- Local extension updated with a backup under workspace
  `outputs/parameter-editor-backup-20261029/`.
