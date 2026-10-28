# SillyTavern World Info Scanner

`src/worldbook/vendor/scanner.ts` and `src/worldbook/vendor/entries.ts` contain
the World Info scanning core, entry template, and field backfill logic from
SillyTavern, copyright its contributors, under AGPL-3.0-or-later.
The license is included at `src/worldbook/vendor/LICENSE`.

Source: https://github.com/SillyTavern/SillyTavern
Revision: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
Original files: `public/scripts/world-info.js`, `public/scripts/constants.js`

`scripts/vendor-world-info.mjs` reproduces the extraction. The original matching,
recursion, grouping, budget, probability, and timed-effect algorithms are retained.
Their dependencies are supplied through an isolated function scope; the original
UI, global event bus, global worldbook selection, and automation hooks are not used.

The scanner is included in the distributed bundle. Its applicable AGPL obligations,
including provision of corresponding source, must be retained when redistributing
or modifying this build. The corresponding source and build scripts are published
alongside the bundle in this repository. This notice does not purport to relicense
unrelated third-party code.
