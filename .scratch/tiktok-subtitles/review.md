# TikTok implementation review

Status: runtime and integration-review findings resolved. Final browser evidence is recorded in browser-validation.md.

Review reference: `7caca7901b73a26849a4a14198f42a50a6e87a56`. Both reviewers inspected the staged feature snapshot before commit with `git diff --cached <reference>`. Unrelated working-tree edits were excluded. Both independent reviewers used `gpt-5.6-sol` with high reasoning; the user explicitly allowed other models for review.

## Standards

1. **P1, documented rule:** The controller checks that `subtitles` is an array but does not validate its members. A null member can reach code that destructures a track. Validate the external event before accepting `VideoData`. **Fix pending.**
2. **P1, documented rule:** A stale `show` or error operation can hide the current picker after an await. Stale work must not change current UI state. **Fix pending.**
3. **P2, judgment:** `_syncData` and `_syncDataArray` duplicate fetching, freshness checks, delivery, and error handling. Normalize the inputs and share the workflow where this makes the code simpler. **Fix pending.**
4. **P2, judgment:** The TikTok adapter combines pure caption decoding with DOM, network, and lifecycle effects in one long file. Consider a small separation of the pure caption code. **Under assessment.**
5. **P3, tooling overlap:** The unused `property` helper is unnecessary. **Removed by the primary agent.** The full verification command independently reported the same unused helper as its sole lint error.

## Spec

1. **P1:** The initial context event can arrive before Binding subscribes. With multiple preloaded videos, Binding skips the initial caption request and the picker can remain loading. Add a context handshake and a late-subscriber regression case. **Fix pending.**
2. **P2:** Page-only tests do not exercise the full approved page-to-extension flow, settings, picker delivery, or legacy unscoped events. Passing old Binding tests is not new integration evidence. **Additional evidence pending.**
3. **P2, rejected finding:** The reviewer classified the `AGENTS.md` policy as unrelated scope. The user explicitly requested these model and speed rules. The staged file contains only those task rules; unrelated setup pointers remain unstaged. **No code change needed.**
4. **P1:** A queued manual-selection message can use the current request token instead of the token of the picker that created it. Carry the picker request token through the public UI message. **Fix pending.**
5. **P2:** Stale async work can hide a newer picker. This overlaps Standards finding 2. **Fix pending.**
6. **P2:** A context change invalidates results but does not cancel obsolete network work. Abort pending requests when the context changes. **Fix pending.**

## Final static re-review

The lists above preserve the initial findings. Their final dispositions supersede the initial pending labels:

- Standards 1: resolved by validating each external subtitle track, including optional file data.
- Standards 2 and Spec 5: resolved by captured request IDs and freshness checks around asynchronous UI work. Error-dialog state includes the captured request ID. Both reviewers checked the follow-up changes.
- Standards 3: resolved by one normalized subtitle-sync workflow.
- Standards 4: accepted as a local design choice after assessment. Pure helpers have one consumer; a new module would add an interface without improving the current use.
- Standards 5: resolved by removing the unused helper.
- Spec 1: resolved by a context replay query and late-subscriber regression test.
- Spec 3: withdrawn; the user explicitly authorized the agent rules.
- Spec 4: resolved by carrying the displayed request ID through picker actions. Manual picker opening and model creation also capture their request ID before asynchronous work.
- Spec 6: resolved for both navigation and same-context replacement. The replacement stays active; an aborted request cannot publish later. The primary independently ran all 19 page tests successfully.
- Spec 2 remains open pending shared-flow integration evidence. Existing Binding tests alone do not close it. A real-Binding test draft failed during Jest module loading on `import.meta` in `localization-fetcher.ts`, before exercising behavior. The unaccepted draft is preserved outside the repository; it is not counted as a regression test.

Neither reviewer has a remaining actionable runtime finding in the reviewed snapshot. Static review does not establish live browser acceptance. The Mac is locked, and the installed production extension must be reloaded after unlock.

## Follow-up evidence review

- The Mac was unlocked and manual English caption delivery was verified in the built extension. The user then took browser control; remaining live acceptance is pending that handoff.
- A real-Binding test harness now runs. The primary independently verified three integration tests and a focused 44-test page/Binding regression run.
- The focused test reviewer found a P1 false-positive risk in the transition case: only one Binding was created, and successful delivery for the next request was not asserted. Two live Bindings plus a successful new-request confirmation are required. A P2 duplication finding requests a shared browser/File/frame fixture. Both fixes are in progress.
- A separate read-only navigation inspection found no proven key-ownership defect. Inactive TikTok bindings unbind their keys and reset subtitles. The live timestamp observation overlapped user interaction and needs a clean browser reproduction; no speculative navigation change was made.

## Final follow-up disposition

- The transition test now creates two real Bindings, rejects stale A actions, confirms B, and checks rendered B text. Shared browser/File/frame setup is extracted into one fixture. This closes the integration evidence finding.
- The inactive video rectangle is entirely below the viewport. Debug output is removed. The constructor keeps its original empty displayed-subtitle array.
- Live testing found two additional root causes: reset retained visible subtitle overlays, and fullscreen positioning used a locally offset parent. Reset now clears displayed state and hides both overlays. The overlay now prefers a suitable actual fullscreen root while retaining the existing fallback.
- A focused reviewer assessed both fixes. Primary verified the three-line reset diff preserves all prior unrelated edits, and verified live fullscreen and related A-to-B-to-A caption delivery after rebuilding.
- Final focused regression: 4 suites, 44 tests passed. Extension typecheck and lint passed (one existing hook dependency warning). Production build passed.
