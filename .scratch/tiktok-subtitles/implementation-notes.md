# Implementation and validation notes

Status: review fixes and browser acceptance checks are in progress.

## Implementation

- TikTok has page registration, settings defaults, metadata, a page entrypoint, and a local site icon.
- Caption discovery validates TikTok page data and associates requests with a video identity. WebVTT is preferred over a duplicate creator-caption JSON representation.
- Creator JSON uses timed utterance text, converted to WebVTT for the existing parser.
- Canonical-page fallback handles stale hydration and expired caption URLs.
- The shared subtitle flow now carries request identity through discovery and checks freshness before subtitle application. Review found further picker-ownership and startup-handshake fixes; see `review.md`.
- No package dependency or navigation shortcut change was added.

## Verified before review fixes

| Gate                                                | Result                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Focused TikTok page tests, independent primary run  | 11/11 passed before the final five cases were added                                       |
| TikTok page tests, agent handoff and full-suite run | 16/16 passed                                                                              |
| Extension TypeScript, independent primary run       | Passed                                                                                    |
| Chromium production build                           | Passed; 8.61 MB output in `extension/.output/chrome-mv3`                                  |
| Full common tests                                   | 32 suites, 528 tests passed                                                               |
| Full client tests                                   | 1 suite, 3 tests passed                                                                   |
| Full extension tests                                | 7 suites, 67 tests passed                                                                 |
| Full `verify` command                               | Exit 1 after tests, on the unused TikTok `property` helper; helper has since been removed |
| Focused formatting check                            | Three task files needed formatting; final formatting is pending                           |
| Protected existing file hashes                      | Both match the saved starting hashes                                                      |

The full test suite ran once. Later review fixes require focused regression checks, plus final lint, formatting, type, and build checks. The full-suite log is `/tmp/asbplayer-tiktok-verify.log`.

The production build reports the existing sidepanel and welcome-page script `type="module"` warnings. The build completed successfully.

## Test-first evidence

The first missing-module test failure was a harness/setup failure, so it is not counted as behavioral RED evidence. Subsequent creator-caption conversion and context-transition cases failed because the expected behavior was absent, then passed after implementation. The page agent also reports RED→GREEN cases for malformed data, caption preference, geometry-based selection, stale responses, disposal, unsupported routes, and expired hydration. One stale-hydration canonical fallback test was already green when added.

The current page tests do not by themselves prove the shared controller, picker, or visible browser flow. Those checks are tracked in `review.md` and `browser-validation.md`.

## Shared-flow review fixes

- Synced-data events now validate the complete `VideoData` shape and every subtitle track before accepting external data. Loading payloads with `subtitles: undefined` remain valid.
- Tokenized UI showing and error reporting defer `frame.show()` until the final freshness check. Stale work does not hide or show the current picker.
- Auto and confirmed subtitle selections use one request-guarded sync workflow. Picker actions carry the displayed request token through confirm, open-file, and cancel messages. The UI also guards delayed file reads before local close/disable effects.
- Binding asks the TikTok page script to replay its current context after subscribing. An identical replay leaves the active key binding state unchanged, and the settings refresh does not duplicate a request started by that replay.

| Gate                                                   | Result       |
| ------------------------------------------------------ | ------------ |
| Extension TypeScript typecheck after shared-flow fixes | Passed       |
| Public TikTok page tests after replay/abort changes    | 18/18 passed |
| Existing Binding regression tests                      | 22/22 passed |
| Existing page utility tests                            | 14/14 passed |
| Existing page-config tests                             | 1/1 passed   |
| `git diff --check`                                     | Passed       |

Visible browser integration remains pending the parent-owned browser session being available.

## Independent checks after review fixes

- Primary reran the 18 TikTok page tests: all passed.
- Extension TypeScript: passed.
- Repository-wide ESLint: passed.
- Production Chromium build: passed, 8.61 MB; output includes the review fixes.
- Formatting of every staged source file: passed.
- Repository-wide formatting: failed only on the pre-existing `extension/src/controllers/subtitle-controller.ts` changes. Its hash still matches the protected starting snapshot. That file was not reformatted.
- The Mac locked during visible testing. CUA reported that automatic unlock failed; the user has been asked to unlock it. The current browser still has the earlier production snapshot loaded, so it must be reloaded after unlock before acceptance testing continues.

## Latest review follow-up

- Manual picker opening, model construction, and error reporting capture the request ID before asynchronous work. Both reviewers confirmed the stale-dialog fixes.
- A valid replacement caption request now aborts the previous request for the same clip and context. Aborted work cannot publish even if its external response later resolves.
- Primary independently ran all 19 page tests: passed. Extension typecheck, changed-source formatting, and the production Chromium build passed after these changes.
- The shared-flow integration test gap remains open. An experimental test instantiated real Binding, but Jest failed during import of `localization-fetcher.ts` (`import.meta` is unsupported by this test runtime), before exercising subtitle behavior. This is a harness failure, not behavioral RED. The unaccepted draft was moved outside the repository to `/tmp/asbplayer-tiktok-shared-flow-test-draft.ts`; no test configuration or production modules were changed to force it through. Browser acceptance remains blocked: a fresh native browser access attempt again reported that the Mac is locked and automatic unlock failed.
- Final lint over the repository's configured source paths (`common extension/src client/src`) passed. An unnecessarily broad `eslint .` invocation was stopped; it is not counted as a completed check.

Audit

### Decisions I Made But You Don't Know

- Capture request identity before asynchronous picker work and carry it through UI actions. This fixes ownership at the source, rather than hiding a stale dialog after it opens.
- Abort same-context replacement requests as well as navigation-time requests. This fixes pending-work cleanup; delivery checks remain necessary when external work ignores cancellation.
- Keep the pure TikTok helpers local. They have one consumer, and extracting them would add a module interface without a demonstrated second use.

### What I Am Not Sure About

- The complete live subtitle display and control flow is not yet validated in the updated production extension. Browser acceptance must verify real TikTok layout, picker behavior, settings, subtitle timing, and navigation.
- Shared-flow automated evidence remains absent because the real-Binding draft hits an import-time test harness failure. Page-only tests cannot establish compatibility with existing unscoped sites.

### Assumptions I Made

- TikTok's currently observed caption data and video wrappers remain available on the supported recorded-video pages. Live browser tests are needed to check this assumption against the built extension.

### Counterexample Considered

- A page test can publish the correct tracks while a late Binding misses the context event, or a delayed picker labels old tracks with a new request. Context replay and captured request IDs address these cases; passing page tests alone does not prove the entire UI path.

### Status

needs validation

## Shared-flow tests and resumed browser checks

- The real-Binding test harness now loads successfully. A small Jest transformer supplies the Vite environment constants before TypeScript transformation; the normal module aliases are mapped for Jest.
- Primary independently ran the TikTok and legacy integration tests: three passed. Extension typecheck and focused lint passed.
- Primary ran the four affected page/Binding/integration files with the new transform: 44 tests passed. This is a focused regression run, not a second full-suite run.
- Test review requested two live Bindings and a successful new-video confirmation in the transition test, plus removal of duplicated boundary setup. Those improvements are pending.
- Live manual English caption selection and display now work after a clean production-page reload. The side panel shows 12 expected cues. The user took browser control, so further browser actions stopped. Remaining acceptance checks are listed in `browser-validation.md`.

## Final delivery checks

- Shared-flow review improvements are complete: one shared boundary fixture, two real Bindings, successful B delivery, stale A action rejection, and rendered subtitle assertions. The old-overlay assertion failed before the reset fix and passed afterward.
- Final primary checks: production Chromium build passed; extension TypeScript passed; focused lint passed with one hook dependency warning; four focused suites passed (44 tests). The full suite ran once earlier (598 tests). No second full-suite result is claimed.
- The three reset additions are the only staged changes in `subtitle-controller.ts`. Replacing that reset block with its saved prior form reproduces the user's original dirty file exactly. Unrelated formatting and context changes remain unstaged. Repository-wide formatting retains the documented baseline failure; owned file formatting passes.
- Final browser checks passed for normal/fullscreen display, related A-to-B-to-A transitions, and hover pause/resume. Earlier controlled checks cover manual/automatic loading, English preference, French manual selection, unchanged-URL home feed, no captions, and keyboard seeking/repeat.

Audit

### Decisions I Made But You Don't Know

- Reset clears both visible overlays and displayed-cue state. This fixes the root cause: an empty subtitle collection caused later rendering to return before clearing the previous text.
- Prefer a suitable actual fullscreen root for overlay positioning. This fixes duplicate parent offsets; the original fallback remains for unsuitable roots.
- Enabled existing hover pause/resume only in the isolated test profile after the user's report. The product default is unchanged.

### What I Am Not Sure About

- TikTok can change its markup and supplied-caption formats. Live evidence covers the recorded samples in browser-validation.md; it does not cover all accounts, locales, or unsupported routes.

### Assumptions I Made

- The approved desktop Chromium recorded-video scope remains the release boundary. No captions are generated and mining is excluded.

### Counterexample Considered

- Revisiting a clip can reuse the same cue index. Clearing displayed state as well as overlays prevents an unchanged-index comparison from suppressing the next render.
- A fullscreen element can be unsuitable for clickable overlays. The existing fallback remains behind explicit containment, height, and clickability checks.

### Status

ready for review
