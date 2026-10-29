# Preset Output Mode Fix

## Scope

- The selected preset output mode supplies one shared submission instruction
  to the host contract and the end of the optional checks.
- Ordinary output requests a single final JSON object without a printed
  thinking block. Tool output requests `submit_image_plan` once.
- Custom visual rules and checks are preserved; no new conflict detector,
  error messages, transport fallback, workflow or layout changes.
- A separate user preset export was repaired using the rules and three
  visual entries in the supplied request, rather than replacing them with
  older local rules. Five exact replacements removed the tool-only
  submission requirements. Dynamic layout catalogs, story text, worldbooks
  and credentials are not included in that export.

## Verification

- Regression tests failed first against the old submission contract.
- `npm test -- src/autoTag src/api src/presets`: 18 files, 282 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, with the existing large-bundle warning.
- `git diff --check`: passed.
- Local SillyTavern loaded version 0.3.18, imported the repaired preset via
  its import button, and persisted it as the active ordinary-output preset.
  Previous presets were retained.
- The free local-check preview contained eight messages, the ordinary-output
  instruction and the single-JSON requirement, with zero references to
  `submit_image_plan`.
- No paid text-generation or RunningHub image requests were made.
