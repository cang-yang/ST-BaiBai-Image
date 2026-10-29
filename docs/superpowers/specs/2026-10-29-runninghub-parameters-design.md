# RunningHub Parameter Editor

## Approved Direction

Use a compact common-settings surface and a complete grouped advanced editor.
The user approved autonomous implementation and clarified that this must be
generic workflow control, not special compatibility for one MOSS workflow.

## Product Contract

- Common controls and advanced controls edit the same workflow scalar values.
- Preserve cloud topology, prompt bindings, credentials, manga settings and API
  submission semantics. Do not send paid requests during verification.
- Do not infer generation modes or branch purposes from a specific workflow's
  topology, titles, IDs or models. Edit the original scalar inputs only.
- Preserve author-provided node titles and scalar types. Boolean inputs are
  toggles; options appear only when explicit portable definitions supply them.
- Generic workflows expose boolean controls prominently. Optional portable
  parameter definitions may name and promote other controls and provide exact
  dropdown choices. Users can rename and pin/unpin any scalar directly in the
  editor. Unknown values/options remain editable without guessing.
- Advanced parameters are grouped by node and searchable by title, ID, translated
  field name or original field name. No repeated binding menu on every row.
- Typed editing rejects empty/invalid numbers and preserves booleans. Dynamic
  sources appear in an explicit advanced source editor, restricted to compatible
  scalar types and known numeric fields.
- Record an initial workflow for new imports. Older saved workflows use their
  upgrade-time values as the baseline. Per-field and global reset restore only
  existing scalar inputs in matching node classes, never topology.
- Imported metadata is optional, validated, persisted and exported without keys.
  Stale metadata falls back to generic controls with a visible warning.
- Reuse existing theme, icon and select components. Common settings stay
  unframed; mobile gets stacked rows, full-width selectors and wrapping labels.

## Boundaries

No node graph canvas, executable metadata, inferred model inventories, arbitrary
node bypass, automatic paid tests or reconstruction of missing platform schemas.

## Verification

Unit tests cover generic control configuration, typed edits, binding, reset and
metadata round-trips. Browser checks cover real file import, boolean changes,
rename/pin, advanced search, sources and resets at desktop/mobile widths, then inspect generated
overrides locally. Build and typecheck before installation and fork push.
