# TikTok subtitle display and navigation

Status: ready-for-agent

The user approved the testing seams, two-ticket breakdown, dependency, and review baseline 7caca7901b73a26849a4a14198f42a50a6e87a56. The product scope is agreed. The user has requested implementation, review, a commit on the current branch, and a browser with the extension ready to test.

## Problem Statement

Language learners cannot reliably load TikTok's available caption tracks into asbplayer and navigate their subtitles. TikTok changes videos without always changing the page URL, keeps other videos preloaded, and can retain page data for a previous clip. An integration that confuses these videos can display or seek through the wrong subtitles.

## Solution

Support TikTok's ordinary recorded videos in desktop Chromium, on direct video pages and the home feed, including fullscreen. Show TikTok-supplied timed captions through asbplayer's existing subtitle display and controls. Keep captions and subtitle navigation associated with the intended video as the user moves through clips.

Reuse the user's existing settings. Preserve playback while captions load and preserve a paused video's identity. Clear old subtitles on a video change. Keep TikTok's own captions under the user's control.

## User Stories

1. As a learner, I want to load captions on a direct TikTok video page, so that I can read them through asbplayer.
2. As a learner, I want captions on the home feed, so that I can study while browsing videos.
3. As a learner, I want caption tracks supplied by TikTok to appear in the existing picker, so that I can choose what to read.
4. As a learner, I want available creator captions and automatic captions supported, so that I can use the timed text supplied for a clip.
5. As a learner, I want available translated tracks offered without generating new translations, so that I can choose among TikTok's tracks.
6. As a learner, I want my existing automatic-loading setting respected, so that TikTok follows my normal workflow.
7. As a learner, I want manual caption loading when automatic loading is disabled, so that I control when subtitles appear.
8. As a learner, I want remembered language choices reused for TikTok, so that I do not repeatedly select the same language.
9. As a learner, I want unavailable preferred languages handled through the existing prompt preference, so that the extension does not silently choose another language.
10. As a learner, I want existing subtitle appearance settings respected, so that TikTok subtitles remain readable to me.
11. As a learner, I want subtitles timed to the intended video, so that the displayed words match its playback position.
12. As a learner, I want subtitle display to remain correct when I pause, so that I can read at my own pace.
13. As a learner, I want subtitles to follow a manual seek, so that I can move freely within a clip.
14. As a learner, I want my existing previous- and next-subtitle controls, so that I can navigate sentence by sentence.
15. As a learner, I want the existing beginning-of-subtitle and repeat controls, so that I can revisit a line.
16. As a learner, I want my configured shortcuts and existing navigation limits preserved, so that controls remain familiar.
17. As a learner, I want correct subtitles in fullscreen and after leaving fullscreen, so that changing the viewing mode does not change my track.
18. As a learner, I want subtitles refreshed when I advance or return to a related video, so that they follow the clip I am viewing.
19. As a learner, I want captions refreshed when the home-feed URL stays unchanged, so that feed navigation still works.
20. As a learner, I want already-preloaded videos handled correctly when they become current, so that loading events are not required for every transition.
21. As a learner, I want off-screen videos kept separate, so that their captions cannot replace the current clip's subtitles.
22. As a learner, I want old subtitles cleared immediately when I change clips, so that stale text never remains while new captions load.
23. As a learner, I want delayed caption responses discarded after I move away, so that fast navigation cannot restore an old clip's text.
24. As a learner, I want videos without caption tracks to clear previous subtitles, so that missing captions do not produce misleading text.
25. As a learner, I want playback to continue during normal caption fetching, so that loading does not interrupt viewing.
26. As a learner, I want a video I paused to stay paused during caption fetching, so that the extension does not resume it unexpectedly.
27. As a learner, I want the existing caption picker's pause and resume behavior, so that making a selection remains predictable.
28. As a learner, I want caption download failures shown through the existing error display, so that I know why subtitles did not load.
29. As a learner, I want TikTok's own captions left under its controls, so that the extension does not change another caption display without my choice.
30. As a tester, I want a visible browser running the built extension, so that I can test the completed feature myself.

## Implementation Decisions

- Extend the existing site registration, caption discovery, subtitle loading, display, and navigation flow. Keep new TikTok logic together. Preserve surrounding module structure.
- Use TikTok-supplied timed caption tracks only. Reuse existing subtitle parsers. Convert a supplied caption representation at the adapter when necessary; do not add speech transcription or image text recognition.
- Accept external page data as unknown. Validate its structure, video identity, caption fields, formats, URLs, and timing values before using them. Distinguish no tracks from malformed data and retrieval failure.
- Prefer initial page data only when its video identity matches the intended clip. Fetch the normal canonical video page when initial data is absent or stale. Browser research proved this fallback on direct-page navigation and the home feed.
- Use explicit clip identity and request association. URL alone, playing state alone, and response arrival order cannot identify the intended video. Keep a paused clip associated with its own captions.
- Associate track discovery and eventual subtitle delivery with the intended video. Reject stale results at delivery, including after the same clip is revisited. Keep existing supported sites compatible with any necessary shared messaging change.
- Clear the previous clip's subtitle state when the intended video changes. Do not substitute another caption language when the selected language is unavailable.
- Reuse automatic-loading, language, display, picker, error, and subtitle-navigation behavior. Add no new TikTok preferences without evidence of a required limitation.
- Use pure functions and immutable values for validation, track selection, identity decisions, and state transitions. Keep DOM, network, event, and playback effects in thin feature adapters. Represent expected errors as values.
- Respect expiring caption URLs and clean up event listeners and pending work. Do not add a background service, new parser dependency, broad refactor, or speculative cache.
- The exact event-routing mechanism remains an implementation choice within these requirements. Validate it against multiple video bindings and existing unscoped site events.

## Testing Decisions

- Approved automated seam: the public page-script/extension caption event flow. Feed realistic page data, DOM video changes, and controlled external network responses through that flow. Observe tracks and subtitle delivery associated with each video. Do not call private methods, test helper internals, or mock owned collaborators.
- Approved browser seam: the built extension's visible subtitle display and public controls. Observe the actual subtitle text, intended video, playback position/state, track selection, and navigation in desktop Chromium. Use live TikTok pages for source and layout compatibility; controlled scenarios may supply deterministic delayed responses and malformed external data.
- Prefer these two high seams over separate tests for every helper. Prior art includes the existing public event tests for page caption inference and the existing subtitle-navigation behavior. Some old tests access private internals; do not copy that approach.
- Run one failing behavior test, add the smallest implementation that passes it, and repeat. Test the direct-page path before video-transition paths. Confirm failure is caused by the missing behavior rather than a broken harness.
- Cover valid caption formats, malformed input, missing tracks, preferred-language mismatch, failure responses, multiple preloaded videos, paused clips, stale initial data, unchanged URLs, delayed results, and revisiting a clip.
- Verify normal playback, pause, seek, configured subtitle navigation, fullscreen, existing prompts, and native-caption non-interference through the browser seam.
- Include compatibility evidence for the shared caption flow on an existing supported site when that flow changes.
- Run focused test files and typechecking during implementation. Run the full project test suite once at the end, plus required lint, formatting, and build checks. Attribute pre-existing failures separately.
- Use the starting commit as the approved review reference. Review the task's changes along the Standards and Spec axes with independent subagents. The user permits other models for code review. Preserve and exclude pre-existing unrelated changes from the task's commit.

## Out of Scope

- Firefox, Android, native TikTok apps, LIVE streams, photo posts, and third-party embedded TikTok players.
- Mining, Anki integration, card creation/export, audio recording, and screenshot capture features or acceptance tests.
- Generating captions, translating text independently, or extracting text burned into video frames.
- Automatically hiding TikTok's own caption display.
- New general-purpose site frameworks, changing existing subtitle navigation semantics, unrelated cleanup, and changes to the user's existing work.

## Further Notes

Live research retrieved a WebVTT track from each of four captioned videos and verified a fifth video with no tracks. The installed VTT parser parsed one 12-cue file without errors. Browser probes do not establish actual extension compatibility or broad TikTok reliability.

TikTok's page and network data are implementation details that can change. A real browser test is required before claiming support. The user has asked for the browser to remain available for manual testing after delivery.

The spec author is the primary agent. Implementation and other delegated work use Luna with maximum reasoning. Code review may use other models, as the user later allowed. Use normal model speed. The current branch will be retained.

The user also explicitly requested that the subagent model and normal-speed rules be written into `AGENTS.md`. Those rules belong to this task. Existing repository setup pointers are excluded from its commit.
