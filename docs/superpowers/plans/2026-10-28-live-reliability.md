# Local Illustration Reliability Plan

**Goal:** Deliver a configured local SillyTavern that can produce validated image plans and real RunningHub manga images, with evidence for each tested path.

**Architecture:** Keep the existing preset, local worldbook and RunningHub modules. Diagnose the real browser-to-SillyTavern-to-provider boundaries before changing request behavior. Use neutral adult-character story fixtures for image quality comparisons.

**Tech Stack:** Existing Vue/TypeScript plugin, Vitest, local SillyTavern, Playwright, OpenAI-compatible secondary API, RunningHub.

## Constraints

- User authorized unattended execution and actual API/image tests.
- Never commit credentials, personal settings, chat history or unredacted network captures.
- Preserve existing user data; settings backup is in ignored `.preview/`.
- Keep MOSS-Image-SFT without LoRA as the baseline.
- Do not call local success a production fix without reproducing the relevant behavior.
- Image quality is evaluated against observed outputs, not promised as perfection.

## 1. Actual Request Diagnosis

- [x] Locate and start the existing local SillyTavern on loopback port 8000.
- [x] Back up settings and download the published plugin.
- [x] Configure the authorized secondary channel through the plugin.
- [x] Run connectivity, preset preview and automatic story-plan requests in the real browser.
- [x] Compare request destination, transport, stream mode and resulting responses without recording keys.
- [x] Reproduce the reported failure or identify the missing environmental difference.
- [x] Add focused failing regression tests for each confirmed defect before fixing it.
- [x] Preserve rejected response evidence without marking invalid plans successful.

Observed: automatic non-streaming request failed after 61.1 seconds. SillyTavern logged upstream OpenResty HTTP 504 and wrapped it in a local HTTP 200 JSON error. Retry succeeded in 42.9 seconds. Streaming automatic generation subsequently succeeded in 30.0 seconds. This identifies the reproduced failure, not every historical failure on the user's other installation.

## 2. Preset Interaction

- [x] Reproduce the open three-dot menu not closing on outside pointer input.
- [x] Fix outside-click and Escape dismissal while retaining inside-menu actions.
- [x] Verify import, edit, save, activation, export/reimport and cancellation.
- [x] Verify desktop and mobile layout with screenshots.
- [x] Verify local worldbook inclusion and isolation from main story generation.

Worldbook import, keyword hit/miss and disabled-entry filtering passed in the real UI. Actual request-body comparison with an enabled matching entry confirmed its marker absent from the main story request and present in the subsequent automatic image-plan request.

## 3. Workflow and Images

- [ ] Recover the previously authorized RunningHub credential from existing local session/configuration without displaying it.
- [x] Import the existing no-LoRA MOSS-SFT workflow and verify model, dimensions and prompt mapping.
- [ ] Run an actual story-to-plan-to-image path from SillyTavern.
- [ ] Inspect the produced image for framing, detail, dialogue and character consistency.
- [ ] Adjust only observed quality problems; retain originals for comparison.
- [ ] Repeat the completed path to distinguish a one-off success from a repeatable result.

Credential unavailable in this installation and existing delivery files; user was asked to enter it locally. No new image has been generated. Three actual model-generated plans compiled successfully to 1664x2496 bounding boxes, but that does not establish visual quality.

## 4. Delivery

- [x] Run focused tests, full tests, typecheck and production build.
- [x] Review changes and redact all delivery artifacts.
- [ ] Deploy the verified bundle to the local installation and push the fix to the fork.
- [ ] Leave the local server accessible and document tested paths, images and any unverified limits.
