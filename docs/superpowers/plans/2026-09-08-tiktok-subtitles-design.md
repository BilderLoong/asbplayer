# TikTok subtitle display and navigation

Status: product scope agreed. The user has requested spec creation, tickets, implementation, review, commit, and a browser for testing. The user approved the testing seams, two-ticket breakdown, dependency, and review baseline. Implementation is authorized.

## Settled scope

- The user wants TikTok subtitle display and navigation.
- Navigation includes moving between TikTok videos and moving between subtitle lines within a video.
- The first version covers direct TikTok video pages and the home feed. Validate direct pages first.
- The first version targets desktop Chromium. Firefox and Android are deferred.
- TikTok follows the existing asbplayer automatic-loading setting. When enabled, automatic loading must follow video changes.
- Use only timed caption tracks supplied by TikTok, including available automatic captions and translations. Do not generate captions through speech transcription or text recognition.
- Reuse asbplayer's language choices, subtitle appearance, and subtitle-navigation controls. Add no TikTok-specific settings unless a confirmed limitation requires one.
- Clear the previous video's subtitles immediately when the intended video changes. Never silently switch to another caption language. Missing preferred tracks follow the existing failure-prompt setting; download failures use the existing error display.
- Playback continues while captions download. Show no subtitles until the correct captions are ready. Preserve the user's paused state and the caption picker's existing pause behavior.
- Leave TikTok's own caption display under the user's control. Automatic hiding is outside the first version.
- Support ordinary recorded videos, including fullscreen, on direct pages and the home feed. LIVE streams, photo posts, and third-party embedded players are outside the first version.
- Mining, Anki integration, card export, audio recording, and screenshot capture are outside this work.
- The user subsequently requested implementation with TDD and functional programming. The primary agent writes the spec and tickets; Luna Max subagents may perform implementation and review.

## Research evidence

See the [feasibility report](/Users/birudo/.codex/visualizations/2026/09/08/01a08183-e924-71a3-9dbe-dad314681d8a/tiktok-feasibility.md).

Browser probes retrieved WebVTT captions from four videos. The installed VTT parser passed a 12-cue browser probe. TikTok can keep multiple video elements loaded, retain stale initial page data after navigation, and change the home-feed video without changing its URL. Full extension display and navigation remain untested.

## Existing behavior to reuse

Source inspection confirmed the following. These describe the current code; they do not authorize changes to it.

- Remembered subtitle languages are keyed by domain in [settings.ts](/Users/birudo/Projects/asbplayer/common/settings/settings.ts:881). The caption picker saves languages when the user enables remembering choices.
- [Track matching](/Users/birudo/Projects/asbplayer/extension/src/controllers/video-data-sync-controller.ts:274) compares remembered languages with available tracks. A missing match can open the picker according to the existing automatic-loading failure preference.
- [Automatic caption retrieval](/Users/birudo/Projects/asbplayer/extension/src/controllers/video-data-sync-controller.ts:530) does not itself pause playback. [The picker](/Users/birudo/Projects/asbplayer/extension/src/controllers/video-data-sync-controller.ts:464) pauses playback and restores the previous playing or paused state when closed.
- [Default subtitle controls](/Users/birudo/Projects/asbplayer/common/settings/settings-provider.ts:176) include previous line, next line, beginning of the current line, and repeat. Respect the user's configured bindings.

## Acceptance criteria

1. On desktop Chromium, available TikTok caption tracks can be selected and displayed with the existing subtitle appearance settings.
2. Subtitle timing follows the intended video's playback time during playback, pause, seek, and supported fullscreen display.
3. Existing subtitle-navigation controls operate on the intended video and its current captions. They retain existing boundary behavior and user bindings.
4. Direct-page next/previous navigation and home-feed video changes refresh captions even when the page URL does not change or the next video was already preloaded.
5. A preloaded or off-screen video cannot receive another video's captions. Pausing the intended video does not make it lose its identity.
6. A late response from an earlier video cannot restore stale subtitles after navigation. Fast navigation remains correct even while multiple requests are pending.
7. A clip without captions or without the preferred language clears old subtitles. Prompt behavior follows existing preferences, with no silent language substitution.
8. Normal caption fetching does not pause or resume playback. The existing picker and error UI retain their normal behavior.
9. Entering or leaving fullscreen does not change the selected track or leave subtitles attached to the wrong video.
10. TikTok's own captions remain under TikTok's controls. No mining, capture, export, or caption-generation behavior is added.

## Remaining engineering validation

- Validate script loading and caption fetches in the actual extension context. Browser probes alone do not establish full extension compatibility.
- Resolve the smallest way to associate requests and responses with the intended video. Recheck shared behavior before changing the document-level event bridge.
- Test current video selection while paused, during fast navigation, and with several preloaded elements. Do not use playing state alone as video identity.
- Check caption format variants, language labels, expiring URLs, and failure paths using real samples. The accepted caption-source scope is broader than the WebVTT samples already tested.
- Reproduce relevant no-caption behavior before changing shared matching logic. The current `emptyChoice` expression compares the boolean result of `.some()` with `undefined`; this suspicious branch was observed but not changed.
- Run focused extraction and navigation tests, then appropriate repository checks and real extension display tests when implementation is authorized.

## Audit

### Decisions I Made But You Don't Know

- None. The product decisions above reflect the user's accepted recommendations. The event-routing mechanism remains undecided.

### What I Am Not Sure About

- Actual extension behavior and all accepted caption variants still need validation. Existing browser probes do not establish release readiness.

### Assumptions I Made

- No additional product scope was added beyond the accepted answers. Acceptance criteria express the agreed display and navigation behavior.

### Counterexample Considered

- A paused clip in the home feed shares the page with a preloaded clip, and an earlier caption request completes. Correct subtitle display must follow the intended clip, not the URL, playing state alone, or response arrival order.

### Status

needs validation

The product interview is complete. This status concerns implementation evidence, not an unanswered scope question.

## Documentation rules

Resolved terms are recorded in [CONTEXT.md](/Users/birudo/Projects/asbplayer/CONTEXT.md). No ADR was created: no hard-to-reverse architecture trade-off has been selected. The implementation request is now present; the required testing-seam and ticket confirmation is complete.
