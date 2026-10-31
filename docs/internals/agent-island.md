# Agent island: design rules, patterns and examples

The island is a compact macOS surface for the requests that block a run (human-in-the-loop, HITL)
and for the light of working agents. It has no chat, no input and no transcript. It is not another
agent runtime, notification inbox, permission system or visual theme. The user guide is
[Agent island](../features/agent-island.md); the request itself is described in
[Human-in-the-loop](../features/hitl.md).

## Design rules

Each rule removes something. Check a change against this list before adding anything else.

1. **No mark, only light.** The folded island is the notch itself and draws no glyph, label, counter
   or badge. When nothing works or waits it draws nothing at all and every click passes through.
   While an agent works, Localix's accent light flows around the notch edge; a waiting request warms
   it and speeds it up.
2. **Only the existing pipelines (A8, C6).** Requests come from the server's attention roster, which
   this window mirrors in its own store (`entities/chat/model/attention`), and the card is
   `HitlAttentionBody` with `embedded`. The island adds no endpoint, store or producer, and writes
   no other surface's state: a request it just answered is only hidden here until the next roster
   agrees. The feature slice imports no other feature (A8).
3. **One card, one vocabulary.** The island has no second card. Answers go through the calls the
   chat uses (`backendClient.interact`, `submitSecret`), and the keys are the card's own: Enter
   approves, Escape denies.
4. **Open only when the app is in the background.** While a Localix window is focused, the island
   does not open, does not take hover or clicks, and the request stays in the app.
5. **Unfolding never takes the keyboard.** A request that appears while the person types elsewhere
   must not receive their next Enter. The panel becomes key only on a click inside the card, and the
   page passes `keyboardActive` to the card only after that engagement. The glass stays active
   without key status (`NSVisualEffectState::Active`).
6. **Folding is never an answer.** A fold, a blur or an outside click leaves every request pending.
7. **Content decides the height.** The page measures intrinsic content and the host clamps it. The
   page never resizes the window.
8. **One number, one place.** Sizes live in `geometry.ts` and its Rust mirror, timings in
   `ISLAND_TIMING`, and motion and radius come from the kit tokens.

## States

`model/island.ts` is a pure reducer: every event carries `now`, nothing reads a clock, and
`nextWake` says when the next `tick` is due. `useIsland` turns pointer, focus and native events into
events and keeps one timer. Test a behavior change in the reducer first.

| State    | Light  | Open | Hit region           | Reached by                                       |
| -------- | ------ | ---- | -------------------- | ------------------------------------------------ |
| Hidden   | none   | no   | none (click-through) | Nothing works or waits, or the app has the focus |
| Working  | accent | no   | none (click-through) | Any conversation is running                      |
| Unfolded | none   | yes  | the card             | A new request, with the app in the background    |
| Folded   | warm   | no   | the notch            | The hold passed, the pointer left, or a fold     |

| Event      | Source                                      | Effect                                                                                                                                   |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`     | Roster, running state or app focus changed  | Unfold a request not shown yet; show the next one when the shown request is gone; fold when the queue empties or the app takes the focus |
| `pointer`  | Native sampler, or the webview in a browser | Starts hover intent (400 ms) or leave (450 ms)                                                                                           |
| `activate` | Click on the notch, or a native first click | Unfold at once and count as engaged                                                                                                      |
| `engage`   | Click, key or input inside the card         | Restart the hold; Enter and Escape may answer                                                                                            |
| `fold`     | Outside click, blur, the host               | Fold; a pointer still over the notch must leave first                                                                                    |
| `tick`     | The one timer                               | Hover opens, leave folds, the 15 s hold folds                                                                                            |

The hold counts from the moment a card opens or is used, and waits while the pointer rests on it. A
leave folds an untouched card but not one the person is answering. A request is unfolded once: after
a fold it stays quiet until hover or a click, and a request that arrived while the app had the focus
unfolds when the person leaves the app.

## Geometry

The canvas never resizes; only the visible silhouette inside it changes. That avoids per-frame
window resizing and keeps the panel anchored to the physical top of the display.

| Size                           | Value                                     | Owner                                         |
| ------------------------------ | ----------------------------------------- | --------------------------------------------- |
| Canvas                         | 720 × 680 points                          | `ISLAND` in `geometry.ts`, `island::geometry` |
| Open width                     | 580 points                                | `ISLAND`, `geometry::OPEN_WIDTH`              |
| Open height                    | content + notch, 64 to 680                | `clampOpenHeight`, `geometry::open_height`    |
| Resting, with a notch          | the notch exactly; transparent when quiet | `Cutout::compact` in `island_macos.rs`        |
| Resting, macOS without a notch | 48 × 28                                   | `island_macos.rs`                             |
| Open corner radius             | `calc(var(--radius) * 3)`                 | kit token, sent to the host on every layout   |
| Resting corner radius          | a third of the open radius                | `material_shape`                              |

The host sends `island-geometry` when displays change (a lid closes, a monitor is unplugged, the
resolution changes), and the page re-reads the cutout without a reload.

## Native host on macOS

- **Panel.** `island_macos.rs` converts the webview window into a nonactivating `NSPanel` that never
  becomes the main window. It joins all Spaces, works beside fullscreen apps, ignores window cycling
  and sits above the menu bar so it can wrap the notch.
- **Mode.** The page sends `island_set_layout` with `mode`: `hidden`, `working` or `waiting`. The
  host derives from it whether the island is quiet (glass at alpha 0) and whether it is interactive.
  Only `waiting` or an open island takes hover and clicks, and the 50 ms pointer sampler runs only
  then.
- **Material.** The island and workspace share `window_material::material_for`. The island reuses
  its material view across theme changes and animates its silhouette with `NSAnimationContext`,
  using the kit's `--ease-emphasized` curve and `--dur-moderate` / `--dur-base`, so the content and
  the glass settle together. Reduced motion is enforced in CSS and in AppKit.
- **Pointer.** `island_pointer.rs` observes local and global mouse events without consuming them.
  Outside the visible silhouette the panel ignores mouse events, so clicks reach the app underneath.
  A click inside makes the panel key, which is when the card's Enter and Escape start to apply.
- **Screens.** An `NSApplicationDidChangeScreenParametersNotification` observer re-anchors the panel
  and emits the new cutout.
- **Keyboard.** Folding calls `release_key_after_fold`, which waits for the fold animation and then
  steps a key panel out of the window list and straight back in: the only way a nonactivating panel
  returns typing to the frontmost app.
- **Lifecycle.** `island.rs` owns showing, hiding and caller checks. Every command rejects callers
  other than the `island` webview, and a session handoff accepts one identifier only
  (`island_destination.rs`). `island_lifecycle.rs` folds and hides the panel on sleep or session
  lock. Space changes fold it.
- **Runtime status.** The island is not a workspace but reads the same API, so `sidecar.rs` also
  publishes the runtime status to its webview.

## Platform contract

The native island is macOS-only. `lib.rs` selects `island.rs` on macOS and `island_unsupported.rs`
elsewhere. The latter retains the IPC names but never builds a window or starts pointer monitors.
`prefs::island_enabled` also returns false outside macOS, and the Settings section is absent. A
non-macOS desktop never loads the island entry.

The browser route remains a development preview on every OS, without native material.

## Ownership

| Concern                      | Owner                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Entry and providers          | `app/main.tsx` picks the entry; `islandEntry.tsx` mounts the kit providers and key dispatcher |
| States, hover and hold       | `features/agent-island/model/island.ts`, `useIsland.ts`                                       |
| Requests and running state   | `useIslandRequests.ts`, `requests.ts`; `attention/store.ts` stays authoritative               |
| Sizes                        | `features/agent-island/model/geometry.ts`, `island::geometry` in Rust                         |
| The card                     | `HitlAttentionBody` (`embedded`), through `IslandRequest.tsx`                                 |
| Native panel, glass, pointer | `island_macos.rs`, `island_material.rs`, `island_pointer.rs`                                  |
| The switch                   | `prefs.rs` (`island` file), `shared/lib/islandSetting.ts`, Settings → Preferences             |

The switch is the `island` file in the app config directory. It holds `on` once the person turned
the island on; a missing file means off, which is the default. `island::set_island_enabled` (any
trusted workspace) shows or hides the panel.

## Patterns

### Listen to a host event

Emit to the island label from Rust, and subscribe with `useTauriEvent`. Validate every payload on
the page: the bridge is untyped.

```rust
let _ = app.emit_to(crate::island::LABEL, "island-collapse", ());
```

```ts
useTauriEvent('island-collapse', fold)
useTauriEvent('island-pointer', (inside) => {
  if (typeof inside === 'boolean') pointer(inside)
})
```

### Add a host command

Guard the caller first, clamp every number, and register the command in `lib.rs`, with a harmless
twin in `island_unsupported.rs`.

```rust
#[tauri::command]
pub(crate) fn island_example(app: AppHandle, caller: Webview, height: Option<u64>) -> Result<(), String> {
    if !is_island(&caller) {
        return Err("Only the island can do this".into());
    }
    let height = geometry::open_height(height);
    // ...
    Ok(())
}
```

### Change a size or a timing

Change `ISLAND` in `geometry.ts` and `island::geometry` together, then run the geometry test and the
native smoke check. Timings live in `ISLAND_TIMING`; motion durations come from the kit's `--dur-*`
tokens, which the host follows through `island_set_layout`.

### Draw activity on the notch

The light is `.lx-island-edge` in `island.css`: a ring just outside the notch, filled by one wide
gradient layer that flows sideways with `transform` only, so the compositor runs it. A conic beam
spun about the centre of a wide, flat notch would point off the top of the screen for half its turn.
The open island draws no edge light.

### Avoid

- A glyph, status line, counter or label in the resting island, or a visible island with nothing to
  say.
- A second card, notification, badge or approval path; read the attention roster instead.
- Taking the keyboard when a card unfolds by itself.
- Writing the attention store of another surface, or patching the roster.
- Resizing or moving the native window per frame, or JavaScript-driven native animation.
- Numeric sizes in `island.css`.

## Verification

| Question                               | Evidence                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| Do states, hover and the hold hold?    | `bun test apps/ui/src/features/agent-island`                    |
| Does the page answer and disappear?    | `bun test apps/ui/src/pages/agent-island`                       |
| Is the switch off by default?          | `bun test apps/ui/src/shared/lib/islandSetting.dom.test.tsx`    |
| Is the native panel real and anchored? | `bun apps/desktop-tauri/scripts/check-agent-island.mjs` (macOS) |
| Does the browser preview still behave? | `bun run test:screenshots --grep 'agents/island'`               |

The smoke check launches a separate app identity against deterministic local HTML. It turns the
island on, then checks the real `NSPanel`, native glass, physical top anchoring, that unfolding does
not take the keyboard, and that the hidden mode draws no glass. It is geometry evidence, not a
product capture. Native motion still needs a feel check on a real device after a rebuild; a still
capture cannot establish frame pacing.
