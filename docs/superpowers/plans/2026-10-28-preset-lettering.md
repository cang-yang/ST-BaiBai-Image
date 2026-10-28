# Preset Contents and Manga Lettering Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the isolated editor task and direct execution for the coupled request changes. User approved design and implementation on October 28, 2026.

**Goal:** Expose all preset content and prevent this user's required-text manga preset from silently generating wordless pages.

**Architecture:** Preserve entries and independently owned rules. Add an optional per-preset lettering policy, shared validation and bounded correction. Keep generated layout geometry and runtime story context external and visibly identified.

**Tech Stack:** Vue 3, TypeScript, Vitest, SillyTavern.

## Global Constraints

- Old presets default to `mangaText: 'auto'`; only `required` opts in.
- No credentials, private story fixtures or personal settings in git.
- No fabricated dialogue; no automatic model/transport switch.
- At most one lettering correction per operation, visible in request history.
- Missing required lettering must never reach image submission.
- Existing entries, rule modes, variables, import/export and cancel semantics remain intact.
- UI reuses existing theme and icons, no instructional walls of text.

## Task 1: Preset policy and request validation

- [x] Test `mangaText: 'required'` survives validate/export/import, absent becomes auto, invalid rejected.
- [x] Test nonempty narrative text vs no text, whitespace, SFX-only, sign-only, multiple pages, invalid layouts.
- [x] Implement `src/presets/mangaText.ts`: policy prompt and `assertMangaText(plan, preset, layoutOn)`.
- [x] Require captions to distinguish speech/thought/narration/message text; use current text schema, no invented layout fields.
- [x] Inject policy only for active manga; validate in runner and preset tests.
- [x] Share bounded correction helper; preserve original request context and append correction instruction, no reasoning transcript.
- [x] Test failure -> correction -> success, two failures -> stop, cancel -> no correction, legacy -> no extra request.

## Task 2: Complete preset editor

Files: `src/pages/settings/ImagePresetSection.vue`, optionally a small directory component, `PresetRuleEditor.vue`, editor-focused tests.

- [x] Show complete content directory on entering edit: all creative entries (including disabled), current spec, current check, output settings, external additions.
- [x] Clicking an entry opens its editor; search/move/delete/add remain functional.
- [x] Show current rule source and character count. Alternative backend rules stay in secondary disclosure.
- [x] Add selector for `draft.mangaText` (`auto`: 按剧情安排; `required`: 必须有叙事文字).
- [x] Existing content/rules/advanced subpanels may be reused but the directory must expose all content immediately, not just entries.
- [x] External additions identify layout settings and fixed protocol as read-only; context is only available after local preview.
- [x] Label preview messages by existing `purpose`, preserving role and full content.
- [x] Test mobile wrapping, keyboard, cancel/save and source visibility. Do not edit runner/model/backend files.

## Task 3: User preset and end-to-end verification

- [x] Create new version of local cute manga preset, preserve old ID and content as backup.
- [x] Separate cute style, narrative text and breakout composition into named entries; remove duplicate tool instruction.
- [x] Add narrowly scoped clarification to custom spec/check: first select source lettering, do not evade with unreadable screens, preserve text type and source.
- [x] Export portable preset artifact without secrets.
- [x] Run focused tests, full suite, typecheck, build.
- [x] Deploy to user's existing local ST; inspect editor at desktop/mobile.
- [x] Exercise three benign source cases (dialogue, messages, narration); verify final plans with the same parser/compiler.
- [x] Attempt one real generated manga page through plugin path and inspect image; report exact results, no unsupported guarantee of perfect lettering.
- [x] Update docs/version and prepare verified scoped changes for release.

Verification details: `docs/verification/2026-10-28-preset-lettering.md`.
Publication is verified against the remote commit after committing; the outcome
is reported separately rather than claimed in the pre-publication checklist.
