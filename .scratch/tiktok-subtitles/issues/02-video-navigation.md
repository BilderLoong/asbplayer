# 02: Keep subtitles correct through related-video and home-feed navigation

**What to build:** Let the learner move between related TikTok videos and through the home feed while subtitles and subtitle-navigation controls stay associated with the intended video. Correctly handle clips that are paused, already preloaded, missing captions, or reached while earlier caption work is pending.

**Blocked by:** 01: Display and navigate captions on direct TikTok video pages.

**Status:** ready-for-agent

**Completion:** implemented and verified; included in the feature commit. The muted production test browser is ready for the user.

The user approved the testing seams and this ticket breakdown.

- [x] Next and previous related-video navigation clear old subtitles and load the new clip according to existing preferences.
- [x] The home feed refreshes subtitles when the intended clip changes but the page URL remains unchanged.
- [x] Preloaded video activation works without requiring another metadata load event.
- [x] Initial page data is accepted only for a matching video. Missing or stale data is replaced with validated data for the intended clip.
- [x] Pausing a clip preserves its identity. Off-screen and preloaded videos cannot replace or receive its subtitles.
- [x] Old subtitle state clears when clips change. No-caption clips and unavailable preferred languages do not retain old text.
- [x] Delayed track or subtitle responses are discarded after their intended request/video is no longer current, including when the same video is revisited.
- [x] Fast next/previous navigation preserves the correct subtitles, selected language behavior, playback state, and subtitle-navigation target.
- [x] Existing site caption behavior remains compatible with necessary shared-flow changes.
- [x] Show red-before-green evidence for transition and stale-response cases at the agreed seams. Verify direct navigation, the home feed, and fullscreen in the built extension.
- [x] Run the full project test suite once at the end and complete the relevant type, lint, formatting, and build checks, reporting unrelated baseline failures separately.
- [x] Complete Standards and Spec review with independent subagents; the user permits other models for review. Commit only this task's changes to the current branch and leave a visible browser with the built extension ready for manual testing.

## Comments

The blocker is necessary: this slice extends the functioning direct-page caption/display path. Final review, build, commit, and browser handoff are delivery checks for this completed feature, not a separate horizontal ticket.

Evidence: see `../browser-validation.md`, `../review.md`, and `../implementation-notes.md`. Automated stale-response checks and recorded live samples are separate evidence; no exhaustive live coverage is claimed.
