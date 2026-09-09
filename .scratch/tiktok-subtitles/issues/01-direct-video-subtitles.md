# 01: Display and navigate captions on direct TikTok video pages

**What to build:** On desktop Chromium, let the learner select TikTok-supplied caption tracks on an ordinary direct video page and display them through asbplayer. Support normal playback, pause, seeking, fullscreen, and the existing subtitle-navigation controls. Reuse automatic-loading, language, appearance, picker, and error preferences.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Completion:** implemented and verified; included in the feature commit. The muted production test browser is ready for the user.

The user approved the testing seams and this ticket breakdown.

- [x] Available timed caption tracks appear in the existing picker and load through the existing subtitle system. Handle supported supplied representations without generating captions.
- [x] Normal automatic loading follows the user's setting. Manual selection remains available when it is disabled.
- [x] Remembered language choices and appearance settings are respected. Missing languages do not silently trigger another language.
- [x] Subtitles follow playback, pause, and seeking. Configured subtitle-navigation and repeat controls retain existing behavior.
- [x] Fullscreen and returning from fullscreen preserve the selected caption track and correct video association.
- [x] Only the intended video's caption requests and results apply, even if the direct page has another video preloaded.
- [x] Normal caption fetching does not pause or resume the video. The picker retains its existing pause behavior.
- [x] Missing tracks follow the existing failure-prompt preference. Retrieval failures use the existing error display. Malformed external data is handled explicitly.
- [x] TikTok's own caption controls are not changed. No mining, capture, or export behavior is added.
- [x] Show red-before-green evidence at the agreed public event seam and verify the built extension through its visible display/control seam.

## Comments

This is an end-to-end direct-page slice, not a parser-only or registration-only ticket. Transition behavior belongs to ticket 02. Both tickets belong to the required first release.

Evidence: see `../browser-validation.md`, `../review.md`, and `../implementation-notes.md`. Automated stale-response checks and recorded live samples are separate evidence; no exhaustive live coverage is claimed.
