# Preset Editor and Manga Lettering Verification

Date: 2026-10-28. Plugin version: 0.3.13.

## Automated Checks

- `npm test`: 84 files passed; 1128 tests passed, 3 existing skips.
- `npm run typecheck`: passed.
- `npm run build`: passed; existing bundle-size warning remains.
- Regression coverage includes absent/invalid lettering policies, portable export,
  page-by-page text validation, legal text slots, narrative container types,
  cancellation, one bounded correction, terminal correction failure, runner
  integration, editor setup order, rule visibility, and keyboard propagation.
- Keyboard regression was observed failing before the fix, then passing after
  handled tab navigation keys stopped bubbling into SillyTavern.

## Local SillyTavern

Verified against the existing local SillyTavern 1.18.0 installation, using its
normal plugin UI and a dedicated synthetic test chat.

- Imported and activated the new lettered preset, keeping the prior preset.
- Directory exposes three creative entries, the independently stored author
  spec/check, output and lettering policies, variables, and external inputs.
- Author spec and check remain separate, editable fields (30111 and 2855
  characters in this local preset), not hidden in the cloud workflow.
- Exercised directory navigation, search including no matches, add/edit/move/
  delete entry, save/cancel, policy change/cancel, and outside-click menu closing.
- Desktop 1440 x 1000 and mobile 390 x 844 inspected. Mobile section client width
  and scroll width were both 317 pixels; directory rows wrapped without overlap.
- After final deployment, ArrowRight selected the next editor tab without
  changing the chat or sending a generation request.

## Actual API and Image Checks

The preset editor's paid API test used the configured `deepseek-flash` channel.
Three synthetic cases produced accepted plans:

1. Dialogue: two source dialogue lines became speech text.
2. Phone messages: message text remained a message, alongside narrative text.
3. No spoken dialogue: three source narration sentences became narration boxes.

These required four requests: the first narration attempt returned malformed
tool JSON and was rejected; a manual retest succeeded. This was not silently
counted as a passing request or sent to image generation.

The validated narration plan was staged in the dedicated chat and the normal
plugin image button submitted it to RunningHub. Workflow remained
MOSS-Image-SFT, no LoRA. The request history reported success in 117.5 seconds.
The 1664 x 2496 result visibly contained three Chinese narration boxes and a
foreground character crossing the panel gutter. It was not a direct cloud UI
generation and no post-generation text was composited onto the image.

During keyboard QA, a bubbling arrow key initially triggered SillyTavern's
swipe action on the dedicated test message. After fixing propagation, only
that test message and its image pointer were restored using the saved plan and
image sidecar. Reload confirmed that the existing generated image displayed
without another paid generation. Prior messages were left intact.

## Limits

- The gate validates structured narrative text and layout compatibility, not
  semantic fidelity to the source or every rendered glyph. One successful image
  is not a guarantee of perfect lettering across seeds.
- This image demonstrated lettering and breakout composition. Its style still
  reads as gentle anime rather than an exact match for the requested cute
  reference; it is not evidence that subjective style tuning is finished.
- Existing presets default to automatic lettering and are not forcibly changed.
- The new policy can request one extra paid correction. A failed correction
  stops the operation rather than entering the general retry loop.
- Credentials, local settings, private stories and generated artifacts are not
  included in this repository.
