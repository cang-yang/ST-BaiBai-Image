# Generation Feedback Verification

Version: 0.3.17
Date: 2026-10-29

## User-Visible Changes

- History rows show live elapsed time without opening details.
- Response headers do not imply that plan content has arrived.
- SSE reasoning and plan/tool-argument characters have separate counters.
  These counters are characters, not token usage or validated output.
- Explicit HTTP 400/401/402/403/404/405/413/415/422 stop the general retry loop.
  Temporary HTTP 503 remains retryable within the existing user budget.
- Local preset checks retain the cleaned target paragraphs and selected
  preset activation state. Empty input stops before request assembly/sending.

## Automated Evidence

Red: 11 new assertions failed for the missing behaviors.
Green: 13 files and 168 tests passed for API, history, preset runner integration,
settings components and text cleaning.

Commands:

```powershell
npm test -- src/api src/state/history.test.ts src/autoTag/presets.integration.test.ts src/pages/settings src/autoTag/clean.test.ts
npm run typecheck
npm run build
git diff --check
```

## Browser Evidence

Inspected local Vue fixtures at 1440 x 1000 and 390 x 844:

- Reasoning-only history, then content arrival with elapsed time.
- Local input check with two retained paragraphs after removing thinking.
- Empty cleaned input error and retained inspection summary.

Screenshots are local-only under `output/playwright/generation-feedback/`.
Fixtures use no credentials and no paid requests. They omit the SillyTavern
world-info host script; its optional import returns 404 in the fixture.
No claim is made that this fixture tests upstream providers or image quality.

## Limits

- Non-streaming providers cannot report incremental character counts.
- HTTP 200 from the host does not establish upstream provider acceptance.
- Structured errors wrapped in HTTP 200 are not generally classified by this
  HTTP-status retry rule. Existing provider-specific explanations remain.
- Progress counters are throttled to 200 ms after their first events.
- Model, workflow, personal presets and layout geometry remain unchanged.
