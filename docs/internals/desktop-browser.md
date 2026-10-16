# Desktop browser integration

The Browser workbench selects a local frame or a native child WebView for each page. Use this guide
when changing page routing, overlays, controller ownership, or native browser bridge readiness.

## How it works

### Native browser pages

A browser tab showing an external site is a child WebView that the shell stacks above the app's own
WebView. App HTML can never paint over it, so the page steps aside while any app overlay is up.

| Moment               | What the page does                                                          | Boundary                                                     |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| No overlay on screen | The native view is framed to its pane box and shown.                        | Hidden while its tab, group, or pane box is not displayed.   |
| An overlay opens     | A JPEG of the current frame is painted in the box, then the view is hidden. | The view hides after 150 ms even when no picture has landed. |
| While it is hidden   | The picture is toned with half of the app's opaque ground.                  | The app's glass surfaces stay legible over a bright page.    |
| The overlay closes   | The native view is shown again over its picture.                            | A close and reopen within one task keeps the view hidden.    |
| The pane moves       | `browser_bounds` receives the new frame, one call at a time, newest only.   | Framing, showing, and hiding are the whole native protocol.  |

The overlay signal is the shared focus stack's `overlayOnScreen`. Shared dialogs, drawers, menus,
popovers, and confirmations claim the stack through `useOverlayFocus`, a ref on the content element,
so a claim lasts exactly as long as that element is mounted and a closed overlay claims nothing.

The pane box and its ancestors are followed by resize and attribute observers, plus window resize
and scroll events. Its native frame is the intersection with clipping ancestors and the window;
hidden, inert, disconnected, or empty hosts have no frame. This catches a maximized-away group even
when its size does not change. The shell never reorders the page against the app's WebView: showing,
hiding, and a picture replace any stacking change.

A renderer lease ties native open, bounds, and release commands to one mounted page controller.
Commands from an old controller cannot affect its replacement. Unmount delivers a final hide after
any pending bounds command; switching pages retains the hidden view and its history. Logical grid
and Browser-strip ownership separately close views when the Browser or its pages are removed. Native
workspace storage keys keep transferred page strips independent across reloads.

On macOS a page introduces itself as the installed Safari: the user agent carries
`Version/<Safari bundle version> Safari/605.1.15`. A plain WKWebView omits those tokens, and Google
then serves its legacy page, which has no dark theme and does not follow the pane's width.

One rule, `browserEngine` in `browserUrl.ts`, picks the engine for every tab.

| Tab                                         | Engine           | Boundary                                            |
| ------------------------------------------- | ---------------- | --------------------------------------------------- |
| The history list                            | The history view | No page behind it.                                  |
| A local page that allows framing            | The in-app frame | The only engine with Visual Feedback and HMR relay. |
| Any other page, or one opened as a web page | A native WebView | macOS and Windows shells; elsewhere it is framed.   |

A typed address loads in place when the tab's engine serves it, and opens where a fresh tab for it
would otherwise (`addressDestination`). A page opened in the browser keeps the native engine, so a
link or redirect to a local server never moves it.

Both engines share `BrowserToolbar`. Reload, frame sizes, dev-server ports, and opening in the
system browser appear on every page; back and forward appear where the engine keeps the page's own
history, which is the native WebView; Visual Feedback appears only for a framed local page. A load
in flight sweeps along the toolbar's bottom edge. What belongs to the browser rather than to one
page lives once on the tab strip: history, a new tab, closing, and reordering by drag. A new tab is
a tab of its own, its address field focused over the pages visited most recently.

The agent bridge is injected once the page's document has parsed and is the one the tab is loading,
never by comparing addresses: a page that rewrites its own URL after loading, as Google search does,
is still the page that loaded. While WebKit reports a load in flight, a `complete` document is the
outgoing one and waits; an `interactive` one is the incoming page and takes the bridge without
waiting for its last resource. A command the bridge cannot run is answered to the agent that sent
it; a page that fails to open, reload, or navigate is reported to the Event Center rather than in a
strip over the page.

## Limits

- Only macOS captures a native page's picture. On Windows a page still hides under an app overlay;
  its box shows the app ground until the overlay closes.
- Linux uses framed pages. The current Tauri child WebView occupies the window's vbox, where wry
  ignores its bounds; native pages require a different host container.
- A native page is a still picture while an app overlay is open. Video and animation appear paused,
  and clicks land on the overlay. Tooltips and hover cards make no focus claim and can render below
  the native page.
- Native pages cannot be clipped or scrolled like an iframe. A fixed frame larger than the pane
  renders at the pane's size; the agent's `viewport` action refuses a fixed size for native tabs.

## Related guides

- [Desktop packaging](desktop-as-primary-artifact.md)
- [Preview control contracts](subsystems/preview-control.md)
- [Visual Feedback](../features/visual-feedback.md)

## Source of truth

- [Native browser pages](../../apps/desktop-tauri/src-tauri/src/native_browser.rs)
- [Browser WebCrypto master key](../../apps/desktop-tauri/src-tauri/src/webcrypto_key.rs)
- [Browser page layering](../../apps/ui/src/features/inspector/model/nativePageLayer.ts)
- [Browser page host](../../apps/ui/src/features/inspector/ui/useNativeBrowserPage.ts)
- [Browser engine selection](../../apps/ui/src/features/inspector/model/browserUrl.ts)
- [Browser toolbar](../../apps/ui/src/features/inspector/ui/BrowserToolbar.tsx)
- [Browser tab strip](../../apps/ui/src/features/inspector/ui/BrowserTabStrip.tsx)
- [Browser bridge readiness](../../apps/ui/src/features/inspector/ui/nativeProbe.ts)
- [Overlay focus claims](../../packages/plugin-sdk/src/ui/focus/useOverlayFocus.ts)
