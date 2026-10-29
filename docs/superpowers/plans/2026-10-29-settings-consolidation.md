# Settings Consolidation Implementation Plan

**Goal:** Simplify everyday configuration and make expressive manga an optional
storytelling preference rather than a mandatory breakout effect.

**Architecture:** Retain current settings storage and request paths. Group the
settings screen without unmounting drafts. Keep enabled layout selection visible;
put geometry editing and legacy selection notes behind advanced disclosure.
Preserve serialized `expressive` for compatibility while removing its breakout
quota. Layout and text validity checks remain.

**Tech Stack:** Vue 3, TypeScript, Vitest, existing SillyTavern installation.

## Constraints

- No new dependencies, image model changes, workflow graph changes or paid draws.
- Preserve user presets, enabled layouts, API keys and custom geometry.
- One bounded correction remains for invalid plans, not absent visual effects.
- Verify affected tests, typecheck/build and desktop/mobile UI only.

## Tasks

- [x] Add failing tests for fully framed expressive pages, no duplicate layout
  capability list, and progressive layout management.
- [x] Update `src/presets/mangaComposition.ts`: validate geometry but do not
  require crossing; replace capability repetition with page-level storytelling.
- [x] Update `src/pages/settings/index.vue`: generation/reference/appearance
  navigation with persistent drafts and keyboard support.
- [x] Update `MangaSection.vue`: compact layout pool, optional per-item editing,
  advanced canvas/legacy controls; retain JSON paste/save.
- [x] Update `ImagePresetSection.vue`: creative controls in content, honest
  plan-only test status, compact rule-source disclosure.
- [x] Refresh the personal manga preset while retaining author format rules
  except the mandatory breakout instruction; retain the model and a backup,
  and do not overwrite arbitrary imported presets.
- [x] Run focused tests, typecheck/build, inspect desktop/mobile, install the
  verified build locally, and record exactly what was and was not verified.
