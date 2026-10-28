# Manga Composition Implementation Plan

**Goal:** Stop silently accepting entirely panel-bound pages for the user's
expressive manga preset, improve content-driven layout variety, and verify real
image results without promising deterministic model rendering.

**Architecture:** A preset-owned opt-in composition policy uses the existing
layout resolver and single correction boundary. Ordinary presets remain
unchanged. Geometry and compiled captions use one source of truth; existing
layout definitions are never silently rewritten.

**Constraints**
- No fixed character identity or fixed layout ID in the new preset.
- No random layout rotation or prohibition on justified repeated layouts.
- Missing required breakout must be reported/corrected, never silently accepted.
- One shared paid correction maximum for text/composition failures.
- Preserve source lettering and distinguish messages, speech, and narration.
- Do not promise image-level typography or composition from JSON checks alone.
- Keep keys, personal settings, and story fixtures out of git.

## Task 1: Capability and acceptance
- [x] Add `mangaComposition: auto | expressive` to model, import/export, editor.
- [x] Test legacy defaults, invalid values and export round trips.
- [x] Add composition planner helper with enabled-layout capabilities and recent
  layout history, using existing image-tag parser; no host mutations.
- [x] With expressive enabled, at least one character page in a nonempty batch
  must actually use a cross-border subject region. Pages without characters and
  single-panel-only plans are exempt. Missing eligible templates is actionable.
- [x] Test nonempty geometry, slanted frames, numbered subjects, disabled layouts,
  stale IDs, single panels, no people, and multiple-page behavior.
- [x] Route plan rejection through the existing one-correction wrapper and run
  focused tests before and after implementation.

## Task 2: Compiler and available layouts
- [x] Strengthen compiled overlap directions only for used crossing subjects;
  specify foreground over frame/gutter, never clip that subject at its panel.
- [x] Add within-panel text sequence metadata to captions without duplicating
  actual text or changing source order.
- [x] Add three opt-in portrait layout artifacts with different topology and
  reserved text areas, leaving normal templates untouched.
- [x] Test geometry validity, readable text regions and actual crossings.

## Task 3: Local preset and verification
- [x] Preserve author rules but replace obsolete X instructions in a new preset,
  remove fixed-three-panel preference and fixed-ID selection notes.
- [x] Reuse cute style; add concise event, lettering-capacity, shot and
  foreground rules. Keep editable rules separate from cloud workflow.
- [x] Export a portable preset and workflow/config bundle without credentials.
- [x] Test two distinct benign narratives through the real plugin API and inspect
  accepted plans, then generate a page through the plugin image button.
- [x] Inspect rendered text/order/borders and report failures honestly.
- [x] Full suite, typecheck, build and local deployment.

Release action after committing: publish to the authorized fork and verify the
remote commit. Final message reports that outcome separately.

## Live QA Inventory
- Composition control: switch auto/expressive and back in the actual editor;
  check desktop/mobile fit, save and reopen persistence.
- New preset: local check and two real secondary-API tests with distinct benign
  narratives; inspect layout, text, selected crossing subjects, and correction.
- Image button: render accepted plans through the normal plugin flow; inspect
  readable text, source order, actual frame occlusion and coherent body, margins.
- Off-happy paths: disabled crossing layouts and detached/touch-only subjects
  are rejected in regression tests; no correction loops; ordinary presets remain
  unchanged.
- Do not equate geometric acceptance with successful model rendering; record
  any failed visual output separately from passing structural checks.
