# Agent island: design rules, patterns and examples

The island is a compact surface of Localix for quick requests, live replies and the existing
human-in-the-loop (HITL) requests. Opening a full conversation is an explicit handoff. It is not
another agent runtime, notification inbox, permission system or visual theme. The user guide is
[Agent island](../features/agent-companion.md).

## Design rules

Each rule removes something. Check a change against this list before adding anything else.

1. **No mark, only light.** The folded island is the notch itself and draws no glyph, label, counter
   or badge. When nothing works or waits it draws nothing at all. While an agent works, Localix's
   accent light flows around the notch edge; a waiting request warms it and speeds it up. The hit
   region is the notch, so menu-bar items beside it keep their clicks, and hovering or clicking the
   notch, or the shortcut, opens the island.
2. **Only the existing pipelines.** Chat, attention, drafts and queueing come from `features/chat`
   and `shared/lib/view-state`. The island adds no endpoint, store or notification producer.
3. **One owner per pixel.** AppKit paints and animates the native glass. CSS paints only the web
   fallback. The page never resizes the window.
4. **Content decides the height.** The page measures intrinsic content and the host clamps it.
   Nothing guesses the height of a reply.
5. **Folding is never an answer.** Collapse, blur, Escape and outside clicks keep the draft and
   leave every request pending.
6. **Open means key, typing is earned.** Like Spotlight, the open island is the key window, which is
   also what keeps Liquid Glass in its active rendering; macOS draws glass in a window without key
   status as flat grey. Every reveal focuses the composer, or the answer input for a request, as
   soon as it mounts. Hover stays a preview until typing or a click makes it an active interaction.
   Folding hands the keyboard back to the app the person was using.
7. **One number, one place.** Sizes live in `geometry.ts` and its Rust mirror, timings in
   `ISLAND_TIMING`, and motion and radius come from the kit tokens.

## Phases

`model/island.ts` is a pure reducer, and `useIsland` turns pointer, focus and native events into its
events. Test a behavior change in the reducer first.

| Event      | Source                                      | Resting →              | Expanded →                                      |
| ---------- | ------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `hover`    | Pointer rests for 400 ms                    | Open, composer focused | No change                                       |
| `activate` | Click on the notch, or a native first click | Open, composer focused | Focus the composer unless a request is shown    |
| `toggle`   | `Cmd+Shift+J`                               | Open, composer focused | Rest                                            |
| `select`   | A new request arrives, or **Next request**  | Open on that request   | Show that request                               |
| `back`     | A file drop                                 | Open, composer focused | Composer focused                                |
| `resolved` | The selected request disappears             | No change              | Composer focused                                |
| `collapse` | Outside click, blur, Escape, idle, handoff  | No change              | Rest; hover is blocked until the pointer leaves |

A hover preview folds 450 ms after the pointer leaves unless the person types, clicks or is
answering an automatically revealed request. Autofocus alone does not pin it. An untouched preview
also folds after 15 seconds as a safety net for a missed pointer exit. A request is revealed once:
after a manual fold it stays quiet until hover or a click.

## Geometry

The canvas never resizes; only the visible silhouette inside it changes. That avoids per-frame
window resizing and keeps the panel anchored to the physical top of the display.

| Size                           | Value                                     | Owner                                            |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------ |
| Canvas                         | 720 × 680 points                          | `ISLAND` in `geometry.ts`, `companion::geometry` |
| Open width                     | 580 points, one size                      | `ISLAND`, `geometry::OPEN_WIDTH`                 |
| Open height                    | content + notch, 64 to 680                | `clampOpenHeight`, `geometry::open_height`       |
| Resting, with a notch          | the notch exactly; transparent when quiet | `Cutout::compact` in `companion_macos.rs`        |
| Resting, macOS without a notch | 48 × 28                                   | `companion_macos.rs`                             |
| Resting browser preview        | 48 × 36                                   | `PREVIEW_GEOMETRY`                               |
| Open corner radius             | `calc(var(--radius) * 3)`                 | kit token, sent to the host on every layout      |
| Resting corner radius          | a third of the open radius                | `material_shape`                                 |

`islandStyle()` turns the numbers into custom properties, so `island.css` holds no geometry
literals. The host sends `companion-geometry` when displays change (a lid closes, a monitor is
unplugged, the resolution changes), and the page re-reads the cutout without a reload.

## Native host on macOS

- **Panel.** `companion_macos.rs` converts the webview window into a nonactivating `NSPanel` that
  never becomes the main window. It joins all Spaces, works beside fullscreen apps, ignores window
  cycling and sits above the menu bar so it can wrap the notch.
- **Material.** The island and workspace share `window_material::material_for`: dark HUD vibrancy
  and light UnderWindowBackground, both with an explicit matching appearance. The island reuses its
  material view across theme changes and animates its silhouette with `NSAnimationContext`. CSS adds
  the same `--background` coat as the workspace; the input uses the common composer shell. A freshly
  attached view is shaped at once, and matching targets do not restart the animation. System startup
  never forces a Dark application appearance.
- **Pointer.** `companion_pointer.rs` observes local and global mouse events without consuming or
  reposting them. Outside the visible silhouette the panel ignores mouse events, so clicks reach the
  app underneath. A 50 ms sampler covers a resting pointer that produces no events; it is idle while
  the island is hidden and queues at most one main-thread sample. A silhouette change re-tests the
  pointer at once.
- **Screens.** An `NSApplicationDidChangeScreenParametersNotification` observer re-anchors the panel
  and emits the new cutout.
- **Menu-bar item.** On macOS a click opens the menu (`show_menu_on_left_click`), as every menu-bar
  extra does; Windows and Linux reveal the app on left click. `build_tray_menu` lists **Quick Chat**
  with its shortcut, **New Chat**, recent conversations, **Open Localix**, **Settings…** and **Quit
  Localix**.
- **Keyboard.** Expanding makes the panel key (`companion::place`). Folding calls
  `release_key_after_fold`, which waits for the fold animation and then steps the panel out of the
  window list and straight back in: the only way a nonactivating panel returns typing to the
  frontmost app. Overriding `isKeyWindow` or `isMainWindow` does not change the glass; AppKit reads
  the real window state.
- **Lifecycle.** `companion.rs` owns showing, hiding, the global shortcut and caller checks. Every
  command rejects callers other than the `companion` webview, and a session handoff accepts one
  identifier only (`companion_destination.rs`). `companion_lifecycle.rs` folds and hides the panel
  on sleep or session lock, preserving drafts and requests. Sleep and lock are separate reasons:
  waking a still-locked session cannot show the island. Space changes fold it; accessibility changes
  reapply the material without changing the task. Hidden panels never capture global clicks.

## Platform contract

The native island is macOS-only. `lib.rs` selects `companion.rs` on macOS and
`companion_unsupported.rs` on other desktop platforms. The latter retains the IPC names but never
builds a window, starts pointer monitors or registers a shortcut. Reading its switch returns false;
writing the switch is a harmless no-op. `prefs::island_enabled` also returns false outside macOS, so
tray menus omit Quick Chat. The UI hides both the settings section and its search results, and a
non-macOS desktop never loads the companion entry.

The browser route remains a development preview on every OS. CSS blur cannot sample another
application through a transparent webview, so the preview uses the kit's existing material and
wallpaper wash. Native AppKit owns macOS glass and its shape. Reduced motion is enforced in both CSS
and AppKit; the system material follows reduced transparency.

## Ownership

| Concern                          | Owner                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Entry and providers              | `app/main.tsx` picks the entry; `companionEntry.tsx` mounts kit providers without the router, Monaco or plugin UI  |
| Phases, hover and focus          | `features/companion/model/island.ts`, `useIsland.ts`                                                               |
| Sizes                            | `features/companion/model/geometry.ts`, `companion::geometry` in Rust                                              |
| Quick conversation               | `useQuickChat.ts` over `createSession`, `useSendMessage`, `useComposerPrefill` and the chat store's stream reducer |
| Selected conversation and draft  | Backend view state ([shared view state](./shared-view-state.md)), `useComposerDraft`                               |
| Session summaries and attention  | `useCompanionState.ts`, `roster.ts`; `attention/store.ts` stays authoritative                                      |
| Request forms                    | `HitlAttentionBody` from `features/chat`                                                                           |
| Notifications, dock badge, menus | The workspace only; the island reads attention and never writes it                                                 |
| Native panel, glass, pointer     | `companion_macos.rs`, `companion_material.rs`, `companion_pointer.rs`                                              |

The island renders the full shared `PromptInput` and `MessageList`. Only geometry changes:
attachments, queueing, failure restoration, the transcript projection and the Markdown renderer are
shared with the workspace. It streams only its own conversation; other conversations arrive as
summaries over the shared resource transport.

## Patterns

### Listen to a host event

Emit to the companion label from Rust, and subscribe with `useTauriEvent`. The hook keeps the latest
handler and releases a subscription even when unmount races `listen`.

```rust
let _ = app.emit_to(crate::companion::LABEL, "companion-collapse", ());
```

```ts
useTauriEvent('companion-collapse', collapse)
useTauriEvent('companion-geometry', (value) => {
  if (isIslandGeometry(value)) setGeometry(value)
})
```

Validate every payload on the page: the bridge is untyped.

### Add a host command

Guard the caller first, clamp every number, and register the command in `lib.rs`.

```rust
#[tauri::command]
pub(crate) fn companion_example(app: AppHandle, caller: Webview, height: Option<u64>) -> Result<(), String> {
    if !is_companion(&caller) {
        return Err("Only the companion can do this".into());
    }
    let height = geometry::open_height(height);
    // ...
    Ok(())
}
```

### Show something new in the island

Render the owning feature's component in its compact presentation, inside `.lx-island-content`. The
content observer grows the island; do not set a height, a `max-height` that hides the composer, or a
second scroll container around the transcript.

```tsx
<QuickChat
  chat={chat}
  attention={pending && <IslandAttention item={pending} /* ... */ />}
  /* ... */
/>
```

Before adding a surface, ask whether it can be a handoff instead: **Open full conversation** covers
anything that needs navigation, settings or history.

### Change a size or a timing

Change `ISLAND` in `geometry.ts` and `companion::geometry` together, then run the geometry test and
the native smoke check. Timings live in `ISLAND_TIMING`; motion durations come from the kit's
`--dur-*` tokens, which the host follows through `companion_set_expanded`. That command takes one
`IslandLayout` object (`expanded`, `height`, `width`, `durationMs`, `easing`, `radius`, `quiet`),
and the host clamps every number. `easing` carries the kit's cubic Bézier control points to AppKit,
so the content and material settle together. Opening uses `--dur-moderate`; folding uses
`--dur-base`.

### Draw activity on the notch

The resting light is `.lx-island-edge` in `island.css`, not the kit's conic beam. A conic beam spun
about the centre of a wide, flat notch points off the top of the screen for half its turn and barely
touches the short sides. The edge is a ring just outside the notch, filled by one wide gradient
layer that flows sideways with `transform` only, so the compositor runs it. While folded, the island
keeps a faint 12-second idle glow and brightens when an agent works or waits. The open island draws
no edge light: the composer uses one focus hairline and a field veil. There is no second blur or
moving composer border.

### One open size

The open island has one width, 580 points: between the earlier standard and enlarged sizes, wide
enough for a reply and narrow enough to stay a glance. There is no size handle; the height follows
the content up to the canvas. `companion_set_grab` widens native hit testing to the whole canvas
only while a composer menu is open, so a portaled menu outside the silhouette stays clickable.

### Turn the island off

`prefs.rs` keeps an `island` file holding `off`; on is the default and removes the file.
`companion::set_island_enabled` (any trusted workspace) hides the panel, ignores the shortcut and
rebuilds the menu-bar menu without **Quick Chat**. Settings → Preferences → Agent island
(`IslandSection.tsx`) is the only writer.

### Avoid

- A glyph, status line, counter or label in the resting island, or a visible island with nothing to
  say.
- A second notification, badge or approval path; read the attention roster instead.
- Resizing or moving the native window per frame, or JavaScript-driven native animation.
- CSS `backdrop-filter` presented as if it sampled the desktop.
- Focusing before an input mounts, refocusing on every render, or treating autofocus as typing.
- Numeric sizes in `island.css`.

## Verification

| Question                               | Evidence                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| Do phases and hover intent hold?       | `bun test apps/ui/src/features/companion`                       |
| Do host events subscribe and release?  | `bun test apps/ui/src/shared/hooks/useTauriEvent`               |
| Is the native panel real and anchored? | `bun apps/desktop-tauri/scripts/check-agent-island.mjs` (macOS) |
| Does the browser preview still behave? | `bun run test:screenshots --grep 'agents/island'`               |

The smoke check launches a separate app identity against deterministic local HTML. It checks the
real `NSPanel`, native glass, physical top anchoring and the compact and expanded material bounds,
then removes its temporary app data. It is geometry evidence, not a product capture. The optional
`agents/island-*` captures exercise the browser preview with an isolated API: draft retention,
shared attention, input focus on every reveal, light/dark appearance, the notch layout and folding
without resolving a request. The native check also flips light → dark → light and verifies that
panel and material agree without losing key focus. Native motion still needs a feel check on a real
device after a rebuild; a still capture cannot establish frame pacing.

## Atoll reference study

Reviewed Atoll at commit `25a8592b105438bf059bfcd146782af23d8c163d`:

- [DynamicIslandWindow](https://github.com/Ebullioscopic/Atoll/blob/25a8592b105438bf059bfcd146782af23d8c163d/DynamicIsland/components/Notch/DynamicIslandWindow.swift)
  keeps a transparent floating panel above the menu bar, on all Spaces, without a window shadow.
  Localix retains its stricter nonactivating panel that never becomes the main window.
- [ContentView hover management](https://github.com/Ebullioscopic/Atoll/blob/25a8592b105438bf059bfcd146782af23d8c163d/DynamicIsland/ContentView.swift)
  cancels delayed hover work, preserves the inclusive screen-top hit area and suppresses closing
  during drags and active popovers. Localix cancels timers, keeps active input and requests open,
  releases drag ownership on folding and passes transparent corners through.
- [Animation defaults](https://github.com/Ebullioscopic/Atoll/blob/25a8592b105438bf059bfcd146782af23d8c163d/DynamicIsland/animations/drop.swift)
  use a 0.4-second SwiftUI spring for the notch. Localix keeps its existing kit vocabulary: a 260 ms
  reveal, 200 ms fold and the shared emphasized curve, now also applied by AppKit.
- [View model](https://github.com/Ebullioscopic/Atoll/blob/25a8592b105438bf059bfcd146782af23d8c163d/DynamicIsland/models/DynamicIslandViewModel.swift)
  owns open/closed geometry and teardown. Localix keeps its fixed canvas, measured content and
  separate sleep/lock suspension, and lets macOS own the material rather than importing SwiftUI.

## Primary references

- [Apple NSPanel](https://developer.apple.com/documentation/appkit/nspanel),
  [NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview) and
  [NSAnimationContext](https://developer.apple.com/documentation/appkit/nsanimationcontext).
- [NotchKit architecture](https://github.com/duongductrong/NotchKit/blob/master/docs/architecture.md):
  fixed canvas, one silhouette owner, content reveal and exact hit testing.
- [Coucou's IslandWindowController](https://github.com/Louis-CFM/coucou/blob/main/NotchBuddy/Sources/App/IslandWindowController.swift)
  and
  [screen geometry](https://github.com/Louis-CFM/coucou/blob/main/NotchBuddy/Sources/CoucouKit/IslandScreenGeometry.swift):
  nonactivating panel and measured notch.
- [DynamicNotchKit](https://github.com/mrkai77/DynamicNotchKit): native panel and hover behavior.
- [tauri-nspanel](https://github.com/ahkohd/tauri-nspanel): macOS panel conversion, pinned to 2.1.1.
- [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/).

### Shared composer and folder picker

The island uses the complete `PromptInput` with `layout="embedded"` for gutters and action size.
`showModelPicker={false}` hides model selection and `showContextBar={false}` removes the island's
context pills. `showTips={false}` disables idle and stream tips without recording impressions. The
workspace keeps these controls and tips. Folder selection uses the shared `ProjectFolderMenu` in
both surfaces, including the same folder icon and Add folder as the first menu action. The native
notch shoulders hold the toolbar so the camera band does not add an empty toolbar row. Shared
portaled menus keep native hit testing through `useIslandOverlays`; clicking a menu row keeps the
island open, while a real outside click still folds it. Resize and overlays share grab ownership so
closing one cannot release the other.
