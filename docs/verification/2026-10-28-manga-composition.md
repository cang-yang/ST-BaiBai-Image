# Manga Composition Verification

## Scope

User reported repetitive `two_then_large` pages, wholly clipped characters,
and stiff lettering/layout. The supplied SSE contained two plans using that
layout; its selected S region was inside F. Descriptive prose alone could not
make that a geometrically crossing region. Separately, the local personal preset
preferred a single three-panel layout and retained obsolete X-slot instructions.

This change introduces opt-in `mangaComposition: expressive`, enabled capability
guidance, bounded recent-layout context, structural acceptance, and one shared
text/composition correction. Ordinary presets remain `auto`. Three optional
editorial layout artifacts add different narrative structures. The local user
configuration installs them explicitly; original templates and presets remain.

## Automated Evidence

- Model serialization, default compatibility, invalid policy rejection.
- Actual used crossing region, numbered subjects, panel-name aliases,
  disabled layouts, missing slots, slanted outlines, no mutation.
- Empty, single-panel and object-only exemptions.
- Detached and edge-touching regions rejected using positive polygon overlap.
- Text and composition failures share two total requests, not nested retries.
- Compiler adds foreground occlusion only for used crossing subjects; records
  direction and per-panel lettering sequence without changing source text.
- Layout artifacts validated and resized with the existing parser.
- Full suite: 86 files, 1160 passed, 3 skipped. Typecheck and build pass.
- Vite retains the existing large-bundle warning; no build failure.
- Independent read-only review identified detached-region acceptance and missing
  lettering order; both were reproduced, fixed and independently retested.

## Local Live Evidence

Environment: existing SillyTavern at localhost:8000, installed plugin 0.3.15,
configured secondary API, MOSS-Image-SFT RunningHub workflow, no LoRA,
1664x2496. Credentials and personal settings are not included in this repository.

The previous preset was retained. A new personal preset removes the fixed layout
preference, retains cute anime styling, and replaces only the author's obsolete
X-slot instructions. Author specification/checklist remain owned preset rules,
not workflow-embedded instructions.

Two isolated benign narratives were submitted using the actual preset test UI:

1. A station message and departure selected `editorial_message_3`.
2. A baking mistake, reassurance and resolution selected `editorial_reaction_4`.

Both produced valid plans with original Chinese text and a used crossing subject,
without requiring a corrective API request. Accepted plans were staged in the
dedicated QA chat, then generated using the normal plugin image buttons. This
tests the real secondary API and image generation paths, not a fabricated raster
or a direct cloud-only submission. It does not represent a new test of automatic
main-story event triggering.

Visual review of the first two outputs:
- Message page: different topology, readable Chinese and coherent character;
  **sideways breakout failed** despite structurally valid crossing geometry.
- Baking page: four panels, visible Chinese, narrative progression, and a
  continuous foreground head covering the bottom frame/gutter. The renderer
  shifted the crossing character toward the right compared with the planned
  region. This is useful output, not pixel-exact compliance.

The side-breakout failure prompted a second bounded iteration: planner guidance
now relates pose to crossing direction; the compiler explicitly names crossed
edges and says the frame must not be drawn over the foreground silhouette.
That wording-only iteration and a subsequent narrowed/right-shifted subject
region still produced fully framed characters. Those failed samples are retained
as `result-A.jpg`, `result-A2.jpg` and `result-A3.jpg`; they are not counted as
successful breakout. Seeds were not held constant, so these are exploratory
samples, not a controlled causal benchmark.

The final message layout retains the distinct left-main/right-two topology but
moves its crossing subject to the lower-right action panel, extending upward.
The left main subject is now intentionally inside its frame; the action panel's
text is in an independent bottom BR region. This deviation from the original
side-crossing design is based on actual raster failures, not a claim that all
directions are equivalent. No ordinary template was changed.

Final re-planning used the revised lower-right S and bottom BR correctly, with
all three source text items. Actual `result-A4.jpg` nevertheless merged the two
right panels by omitting their dividing frame/gutter. It is **not a strict
breakout pass**. The message artifact is explicitly marked experimental and
disabled in the local delivery configuration. The original 19 layouts and the
two other new layouts remain enabled (21 enabled / 22 total). Successful baking
output is `result-B.jpg`; no promise of reliable sideways breakout is made.

Editor controls were exercised through normal clicks: auto/expressive round
trip, save, reopen and persistence. Desktop 1440x1000 and mobile 390x844
screenshots were inspected; the new selector and save controls fit without
horizontal clipping. Existing scrollable sections remain scrollable.

## Limits

Geometric acceptance is not image recognition. It cannot guarantee every
character crosses the frame, exact Chinese glyphs, exact source fidelity or
precise placement. Different seed/subject/pose can produce different results.
Do not describe this release as guaranteed or perfect manga generation.
Live artifacts and portable personal configuration are under the workspace's
`outputs/MOSS-Editorial`, outside the repository.
