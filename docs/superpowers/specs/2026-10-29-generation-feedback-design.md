# Generation Feedback Design

## User Outcome

Reduce wasted waiting and make failures understandable without reading raw SSE.
The user delegated prioritization and implementation. This pass does not change
the model, workflow, author rules, layout selection, or paid request defaults.

## Selected Scope

1. Show the distinction between waiting for headers, waiting for content,
   receiving reasoning, receiving plan content, and validating the plan.
   Show live elapsed time and received character counts, not invented token
   counts or claims that an upstream provider has accepted the request.
2. Do not automatically retry explicit permanent HTTP failures:
   400, 401, 402, 403, 404, 405, 413, 415 and 422.
   Preserve cancellation, bounded correction, transient retries and raw errors.
3. Local preset inspection shows the actual cleaned target text, its paragraph
   count, the selected preset and whether it is active. Empty cleaned text
   blocks both inspection and paid preset testing before any request.

## Alternatives

- A new setup wizard would add another configuration surface: deferred.
- A full request-pipeline rewrite would have a larger regression surface:
  deferred until it is needed for a concrete user outcome.
- Extending existing history and preset inspection is chosen because the
  existing workflows remain recognizable.

## Acceptance

- Reasoning-only SSE updates history before completion without exposing
  reasoning as the final plan preview.
- Valid plan deltas and tool arguments update received-content counts.
- An HTTP 401 with five retries configured sends once; a temporary failure can
  still retry. No successful paid image task is automatically recreated.
- Local inspection never calls the model and keeps cleaned text inspectable,
  including when all content was removed.
- No API keys in diagnostics. No automatic prompt trimming or rule overrides.
- Focused tests, typecheck/build, and desktop/mobile checks only.

## Deferred User-Facing Improvements

- Save and activate a preset in one action.
- Explain incompatible preset/workflow combinations before generation.
- Resume an existing cloud task without redrawing after connection loss.
- Compare a small fixed set of manga examples before changing visual rules.
- Preview layout geometry and text capacity before editing coordinates.

These are candidates, not claims of missing functionality in every path.
