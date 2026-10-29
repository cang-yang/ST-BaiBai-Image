# Generation Feedback Implementation Plan

> Execute inline with executing-plans. Preserve current user configuration.

**Goal:** Make generation progress and input failures visible and avoid
repeating permanently rejected requests.

**Architecture:** Extend current history records and preset inspection. Retain
the request client, runner, correction budget, and settings storage.

**Tech Stack:** Vue 3, TypeScript, Vitest.

## Constraints

- No dependency, model, workflow, layout geometry or author-rule changes.
- No paid generation required for verification.
- Character counts are characters, not tokens.

## Task 1: Observable Streaming

Files: `src/api/client.ts`, `src/state/history.ts`,
`src/pages/history/index.vue`, `src/api/rejectedResponse.test.ts`.

- [x] Add a stream test that pauses after reasoning and plan deltas and reads
  the in-flight history record; expect separate character counts.
- [x] Run `npm test -- src/api/rejectedResponse.test.ts` and observe failure.
- [x] Add optional progress fields and SSE progress callbacks; show live
  elapsed time and the accurate phase in existing history rows.
- [x] Run API and history tests.

## Task 2: Stop Permanent Rejections

Files: `src/autoTag/runner.ts`, `src/api/client.ts`,
`src/autoTag/presets.integration.test.ts`.

- [x] Add integration cases with retryCount=5 and HTTP 400/401/403/422;
  assert one request. Add a temporary-failure case that still retries.
- [x] Run the integration test and observe the permanent-retry failures.
- [x] Export `isPermanentApiError(error: unknown): boolean` and use it only
  to stop the outer retry loop, preserving existing text correction handling.
- [x] Run integration and API compatibility tests.

## Task 3: Cleaned Input Inspection

Files: `src/pages/settings/ImagePresetSection.vue`,
`src/pages/settings/ImagePresetSection.test.ts`.

- [x] Add a component test that invokes inspection with fully stripped text
  and asserts no client call and a useful input error.
- [x] Run the component test and observe failure.
- [x] Retain a local input summary and cleaned paragraphs before request
  assembly; reject zero paragraphs and show preset activation state.
- [x] Run settings and cleaning tests.

## Release

- [x] Run focused regressions, typecheck, build and diff checks.
- [x] Inspect desktop/mobile and install the identical build locally.
- [x] Record limitations and commit/push the scoped version bump.
