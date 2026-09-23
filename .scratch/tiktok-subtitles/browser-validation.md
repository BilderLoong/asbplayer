# TikTok browser validation

Status: completed for the recorded desktop Chromium samples below. Historical blockers are superseded by the final production recheck.

## Environment

- Desktop macOS, Chrome for Testing 151.0.7922.77.
- Separate test profile: `/tmp/asbplayer-tiktok-chrome-01a08183`.
- Development extension: `extension/.output/chrome-mv3-dev`.
- Extension ID: `pdfcepjlkogmpfgjgfkhfpncianbaenl`.
- Developer mode enabled in the separate profile. The regular Chrome profile is not used.

## Checks observed on 2026-09-09

- The extension Settings page renders and lists TikTok under Streaming Video > Pages.
- TikTok page settings open and permit automatic subtitle loading. Global automatic loading is initially disabled in this profile.
- The direct page `https://www.tiktok.com/@hankgreen1/video/7047596209028074758` plays in the test browser.
- The page contains two video elements. The current wrapper is `xgwrapper-0-7047596209028074758`; a preloaded wrapper is `xgwrapper-0-7040943377310960902`. Both can be paused simultaneously.
- Fresh hydration data identifies video `7047596209028074758`. Its `subtitleInfos` contains English `webvtt` and `creator_caption` representations.
- The creator-caption URL returned HTTP 200. Its JSON contains 12 `utterances`, with `text`, `start_time`, and `end_time` in milliseconds. First cue: 44–704 ms. Last cue: 18037–21309 ms. The `words` arrays can span adjacent utterances; line conversion must use utterance fields.

## Manual selector attempt on the live dev tab (2026-09-09)

- Chrome's commands API reports `toggle-video-select` as `⌃⇧F`; CUA sent Control+Shift+F after observing the active TikTok tab.
- The TikTok tab stayed on the sample URL. Both video elements were paused. The page showed two `asbplayer-drag-zone-initial` nodes and the statistics overlay, but no video-select iframe/dialog or visible subtitle layer.
- A direct service-worker diagnostic send to the active tab returned `Could not establish connection. Receiving end does not exist.` The live tab therefore needs a dev content-script reload or tab refresh before manual selector wiring can be judged. This is a mid-edit dev-state limitation, not a feature pass or a production-build result.
- Screenshot: `/tmp/asbplayer-tiktok-feasibility/manual-selector-current.png`.

## Production unpacked load and initial flow (2026-09-09)

- In the isolated profile, the dev extension (`pdfcepjlkogmpfgjgfkhfpncianbaenl`) is disabled and the production build (`extension/.output/chrome-mv3`) is enabled as `hkledmpjpaehamkiehglnbelcpdflcab`.
- A fresh Hank page loaded with two video elements and the production statistics-overlay iframe. The active video is `xgwrapper-0-7047596209028074758`; the preloaded second video is also present.
- Production `chrome.commands.getAll()` reported the selector command shortcut as unassigned in this unpacked profile. CUA could not record a shortcut in `chrome://extensions/shortcuts`, so the service worker sent `toggle-video-select` directly while the fresh TikTok tab was active.
- After two seconds, the fresh production tab still had only the statistics overlay and the two initial drag zones. No video-select dialog/frame or subtitle layer appeared. Manual caption selection and all dependent playback/subtitle-navigation checks were therefore blocked for this production snapshot. This reproduces the observed initial-load blocker, but does not prove that the startup handshake race is its cause.
- CUA screenshot observed the production Hank tab in the isolated browser; the visible page had no selector or subtitle layer. A shell screenshot can capture another Chrome window on this desktop, so no shell screenshot path is claimed as production evidence.
- The primary then sent the same public command with the active video's `src`. This opened the existing subtitle picker with three empty track selections and a remember-choice checkbox. The earlier untargeted multi-video selector failure is therefore distinct from the targeted caption-picker path. No caption selection or visible subtitle delivery was verified before the Mac locked.

## Required before delivery

The Mac locked before further visible checks. CUA reported that it could not unlock the Mac automatically. The user has been asked to unlock it. No browser actions will continue until then. A rebuilt production output now contains the review fixes; reload the enabled production extension and refresh the test page after unlock.

- Manual caption selection, visible subtitle text, playback, pause, seek, and subtitle navigation.
- Automatic loading, remembered language, missing-language and no-caption behavior.
- Direct related-video and unchanged-URL home-feed transitions, including return to a previous clip.
- Fullscreen and return from fullscreen.
- Stale track and subtitle delivery checks, including delayed manual selection.
- Existing-site compatibility for shared-flow changes.
- Final production build loaded in a visible browser and left ready for the user.

## Resumed live checks

- The Mac was unlocked on the next continuation. Native Chrome for Testing control became available.
- The updated page script replayed the current video context. A public diagnostic discovery request returned the matching English WebVTT track with no error. This diagnostic result alone is not delivery evidence.
- After a clean page reload, the targeted public selector command opened the existing picker. The first track list offered `eng-US`. The initial `Vide` label was the empty selection, not proof that no tracks existed.
- Native picker keyboard interaction selected English. The built extension displayed `definitely have a tippity top` over the video. DOM inspection confirmed the asbplayer subtitle elements contained the expected caption text. The remembered language preference contains `eng-us` and two empty-track choices.
- The side panel subsequently displayed all 12 cues with timestamps matching the supplied VTT, from 00:00.044 through 00:18.037.
- A next-subtitle key attempt did not yet establish correct navigation: the observed timestamp changed from 6.966307 to 10.199061, while the next source cue starts at 8.684. User interaction may overlap this observation, so it is not yet classified as a defect.
- CUA then reported that the user changed the browser. The latest native state showed playback and the side panel open. Browser actions stopped to leave control with the user. Fullscreen, automatic loading, transitions, and clean keyboard-navigation acceptance remain pending.

## Controlled checks after the user returned browser control

- The user explicitly returned browser control, then requested mute. TikTok was muted through Chrome's tab menu; native UI confirmed `Son coupé` and that sound was disabled on the page. Keep this setting at handoff.
- A clean paused seek test recorded media events. From 6.066462 seconds, Right sought exactly to 6.819 and remained paused. Left then sought to 3.924 and remained paused. This follows the existing previous-cue rule, which requires the prior cue's end to be strictly before the current time. Up sought to the current cue start at 3.924 and resumed, matching the default `alwaysPlayOnSubtitleRepeat: true`.
- Automatic loading was enabled in the isolated test profile through Chrome storage. After a fresh reload, the remembered English track loaded without a picker; visible text and the 12-cue side panel were verified.
- Native `f` entered TikTok's DOM fullscreen mode. This exposed a positioning defect: video left 464, width 549; the overlay wrote left 738.5 relative to the local player parent, adding its offset twice. Captions appeared outside the video. Returning with Escape restored normal layout. The generic fullscreen-parent fix is pending production recheck.
- Related-video next navigation changed the URL to video `7040943377310960902` and loaded its English captions automatically. It also exposed an old-overlay defect: the prior caption remained under the new caption. The controller reset fix is pending production recheck.
- A fresh visit to no-caption video `7608248907960814879` produced no asbplayer subtitle overlay or picker. No previous captions appeared on the new page.
- On the home feed `/`, native next navigation changed the context to video `7662852895439719712` without changing the URL. The public request and response carried matching video identity and request ID. The response offered `fra-FR`; remembered English did not silently select it, and no subtitles loaded.
- The existing picker offered French. Native selection loaded French captions and the side panel while the URL remained `/`. Remember-choice was off, so this selection did not replace remembered English. Visible text included `Mon frère est né, est sorti 1 soir,` from the supplied track.

## Final production recheck

- Reloaded production extension after the reset and fullscreen fixes. TikTok remains muted.
- Fullscreen subtitle overlay is a child of the actual fullscreen element. Its rectangle matches the video horizontally: x=648.5, width=558. The screenshot shows the caption centered inside the video. Escape returns to the normal player.
- Native related-next navigation to `7040943377310960902` shows only that video's caption layer. The previous Hank caption no longer remains beneath it. Native previous returns to `7047596209028074758` and restores its correct captions.
- Earlier direct, home-feed, language, no-caption, and keyboard checks above remain the live acceptance evidence. Delayed responses and stale picker actions use deterministic automated tests; no claim of a network-delayed live test is made.

- User-reported hover pause: the isolated default profile had no `pauseOnHoverMode`, so the existing default was disabled (0). Set the test profile to mode 1 and reloaded. Real CDP mouse movement over visible subtitle text paused at 10.190666 seconds; a later read remained at that timestamp. Moving outside resumed playback at 10.212. No runtime change was needed. Hover pause/resume remains enabled for user testing.
