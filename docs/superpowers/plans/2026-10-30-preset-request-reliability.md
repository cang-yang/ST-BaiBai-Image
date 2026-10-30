# Preset and Request Reliability

Goal: make preset compatibility and request failures explicit without changing content policies, moving task content into tool descriptions, or claiming legacy behavioral equivalence.

The user authorized autonomous iteration. Keep the existing text/tool plan protocols and backend rules. No new execution engine, opaque fallback, terminal emulation, or arbitrary tools.

- [x] Add failing tests for unsupported API-request imports, request diagnostics without credentials, filtered responses, reasoning-only responses, and accurate terminal progress.
- [x] Preserve local message provenance through preview/history, but remove it from wire messages.
- [x] Record allowlisted actual request parameters and distinguish filtered, incomplete, and reasoning-only results. Stop automatic retries for content-filter termination.
- [x] Refuse to silently discard tools/function protocols during generic preset import. Retain import/export of ordinary message presets.
- [x] Show request parameters and readable message source labels using existing UI controls.
- [x] Run focused tests, typecheck and build; verify a benign local UI flow. Document limits and update the adapted preset's compatibility note only, without changing its visual rules.

Validation uses synthetic, non-explicit examples. No paid API calls or image quality claims. Existing user settings, keys, presets, workflows and worldbooks must not be overwritten.

## Verification

- Full suite: 90 files, 1203 tests passed, 3 skipped. Typecheck and production build passed; Vite retains its existing large-bundle warning.
- Adapted preset: six local prompt-builder cases (text/tool output and three count ranges) passed; rules and feature switches unchanged. No image generation or equivalence claim.
- Installed built assets and versioned manifest into the local SillyTavern extension; prior assets backed up separately. No configuration replacement.
- Playwright: local check on a benign station scene; preview shows seven correctly sourced messages. Intercepted completion endpoint with a synthetic SSE content-filter response, no upstream call. History shows HTTP 200, text output, exact parameters, filter termination and final progress.
- Desktop 1440x1000 and mobile 390x844 screenshots captured in workspace output/playwright. Expanded mobile message rows report zero horizontal overflow and zero label/count overlap.
- Not implemented: legacy terminal impersonation, relocation into tool descriptions, legacy execution/response protocol, or content-filter bypass. The current adapted preset is explicitly not behaviorally equivalent.
