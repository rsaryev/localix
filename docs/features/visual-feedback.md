# Annotate a live preview

Visual Feedback captures element context and available source locations from a Localix preview and
adds them to the session. Use it to point at a live element, describe a visual change, and give the
agent DOM details and any source hints the page provides.

**Scope:** A probe-connected Localix preview is required. Arbitrary browser tabs and desktop windows
are outside this boundary.

![A real application preview in the browser beside the release conversation](../assets/screenshots/browser/agent-preview--2026-10-09.png)

_Preview captured on 9 October 2026 after **Just browse → Review release** changed the demo page
status to **Ready for review**. The conversation is seeded; this frame does not show a feedback
attachment or a model run._

## What you can do

| Action                   | Mechanism                                                                                           | Boundary                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Comment on one element   | Click an element to capture its selector, DOM path, text, role, styles, rectangle, and source hint. | Source resolution and the automatic JPEG are best-effort.                          |
| Add selected text        | Select page text in Visual Feedback mode; it attaches as context immediately.                       | Text quick-add creates no screenshot.                                              |
| Mark empty space         | Drag a rectangle to capture its viewport coordinates.                                               | A region has no element selector or source location.                               |
| Mark several elements    | Drag across elements to retain leaf selectors and discard wrapping ancestors.                       | The capture records one primary element plus a bounded member list.                |
| Comment on the screen    | Sweep across most of the window to capture the whole page instead of a part of it.                  | A sweep that wide discards any text selection it crossed on the way.               |
| Collect review comments  | Each observation becomes one attached context item in the composer, with an optional screenshot.    | Attaching does not send a turn. Commented elements carry a quiet page tint.        |
| Revisit a comment        | Point at a tinted element to read its number and note; click it to edit or delete the comment.      | Removing its context item withdraws the comment and its tint; sending clears both. |
| Check responsive layouts | Pin the iframe to a named CSS viewport size and rotate its width and height.                        | This changes layout size only, not browser or device identity.                     |

### Let the agent drive the preview

The same in-page probe serves the agent's `Browser` tool, so the agent works in the preview you are
looking at. It starts no separate browser, and nothing is installed in your app.

| Agent action                | What it returns                                                                                       | Boundary                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `snapshot`                  | The page as a compact indented text tree whose elements carry `eN` refs, capped at 800 nodes.         | A reload invalidates refs; take a fresh snapshot. Same-origin iframes are read; others are named unreachable.          |
| `read`                      | The page's visible text with whitespace collapsed, 8,000 characters at a time from `offset`.          | Says `characters a-b of N` and the next `offset`; only the newest `read` stays in the agent's context.                 |
| `back`, `forward`, `reload` | Move the tab through its own history, or reload it, and return the page they land on.                 | Native tabs answer with the new page; in a frame the next command does. Refs from the old page are invalid.            |
| `wait` step                 | Holds a batch until text or a selector appears, or goes away (`gone`), then says how long it took.    | Polls in the page for `timeout_ms`, default 10 s, at most 15 s; on timeout the batch stops.                            |
| `select` step               | Picks a dropdown option by value or visible label; the snapshot lists up to 50 enabled options.       | Native `<select>` only; sets the value, fires `input` and `change`, and reports an option already chosen as unchanged. |
| `steps`                     | One ordered batch of `click`, `hover`, `type`, `select`, `press` and `scroll`, validated whole first. | Events are synthesized, so controls that demand a trusted gesture can reject them.                                     |
| Any drive action            | A short diff of what changed, with the full tree on request (`snapshot_after`).                       | Settling waits until the DOM has been quiet for 100 ms, at most 700 ms; a page still loading is flagged.               |
| `take_screenshot`           | The page, or one element by ref, rendered in the page.                                                | A DOM re-render of the viewport, not compositor pixels; capture can fail.                                              |
| `console`, `evaluate`       | Console output and errors, and a page-side expression result.                                         | Preview dialogs are stubbed: `confirm` returns true, `prompt` null. Native tabs: see below.                            |
| `viewport`                  | The frame resized to a named CSS size, checked against the page's real size.                          | Layout only; no device pixel ratio, touch or user agent.                                                               |

You can watch the agent work in a native tab. While it runs a command there, the tab's icon in the
strip turns into a small spinner, which stays for a moment after the last answer. After a click or
typing, a blue box flashes over the element it targeted. The box ignores the pointer, never changes
the page's own content, and appears without the fade when your system asks for reduced motion.

A native browser tab is also the person's own browsing, so its dialogs are left alone, except while
an agent command runs in it: then `alert`, `confirm` and `prompt` are cancelled (`confirm` returns
false, `prompt` null; nothing is ever accepted) and their text comes back with the action. A
stylesheet, script or image that failed to load is listed in the next snapshot, and a link click or
form submit that will replace the page is noticed before the new page commits.

After an action the page is resampled once its DOM has been quiet for 100 ms (never longer than 700
ms), so a result that arrives from the network a moment later is in the diff. If the page still says
it is working then (its own fetch or XHR requests in flight, a shown `aria-busy` main region or
indeterminate progress bar, a document still parsing), the reply says the page is still loading:
read again before acting again.

The diff is ordered: each changed line (`-` gone, `+` new) comes after the unchanged line above it,
with `…` between changes that are apart, so one of several equal lines (a score, a repeated row) is
told by its place. New or known controls carry their `[ref=eN]`. When more than 30 lines changed, or
telling them would take more than the page, the reply is the whole page instead.

A long page is read in windows instead of through `evaluate`: `read` returns the text from `offset`
and ends with the offset to continue from. Going back, forward or reloading changes the page, so
unlike `read` they are confirmed like any other action that drives it.

A page that renders late is read after it rendered: put a `wait` step before the `snapshot` step.
The page polls every 100 ms on a native timer, so a preview in a hidden tab still answers. A batch
made only of `wait`, `snapshot` and `console` steps only looks at the page, so it needs no extra
confirmation.

A ref that goes stale heals itself: the probe retries by its saved selector, then by role and
accessible name, and says so in the result. A click that a dialog covers returns an `intercepted`
error with the tree it needs to dismiss it. Whether this is faster than another way of driving a
page is not measured here; the design avoids sending raw HTML or pixels where a few hundred tokens
of tree will do. The tool needs a connected Localix application with a Preview host; an API-only
headless run cannot complete it. The action and recovery contract belongs to
[Preview control internals](https://github.com/rsaryev/localix/blob/main/docs/internals/subsystems/preview-control.md).

### Resize through the agent tool

The agent can set the same frame dimensions controlled by the toolbar:

```json
{
  "action": "viewport",
  "preview_id": "http://localhost:5173",
  "viewport": { "width": 375, "height": 667 }
}
```

Use the `preview_id` returned by `open`, not an invented target. An ID that names no open tab
returns a `not_found` error listing the open tab IDs and URLs. Width and height are integer CSS
pixels, each from 240 to 3840. The reply reports the page's actual dimensions; a mismatch is an
error. Set `viewport` to `null` to restore **Fill panel**, or swap width and height for landscape.

Tabs stay responsive by default: `open` without `viewport` fits the page to the pane and reports the
actual CSS size. A fixed size is for checking one width. It applies to every later command on that
tab, so a `snapshot` after `viewport` measures the same frame, and each result reminds the agent to
reset it. `viewport: null` or an `open` without a size restores fit-to-pane, and when the agent's
run ends, every tab it pinned returns to fit-to-pane. A size you choose in the toolbar is kept.

To view a local HTML file, `open` it with `file_path`. Localix serves the file's folder, so relative
assets such as `style.css` and `game.js` load without a separate server. When a local URL does not
answer, `open` reports that the page did not load (for example, connection refused) and suggests
checking that its server is still running.

For checks in a delegated child, `open` with `background:true` mounts a native Preview host without
selecting its conversation or revealing the panel. This requires a connected Localix application,
not a standalone headless browser. Opening reports probe readiness separately from URL availability.
Layout resizing does not establish real-device touch behavior.

## How it works

The API injects a browser probe into HTML before the preview loads. Static files receive the probe
from the loopback static server. HTTP and HTTPS previews can receive it through a loopback reverse
proxy that forwards page requests, assets, and WebSocket traffic.

### The proxied page and its app

The proxy serves the app under the app's own host name (`localhost` for `localhost`, `127.0.0.1` for
`127.0.0.1`) on a port of its own. Cookies belong to a host name, not a port, so the app's cookies,
`HttpOnly` session cookies included, apply to the proxied page. The port is derived from the app's
address and stays the same across Localix restarts, so the page's local storage survives them. If
that port is taken, the proxy moves to another one; the page's storage starts empty there, but its
cookies still apply.

The proxy tells the app its own name. `Host` is the app's, and an `Origin` or `Referer` of the
proxied page reaches the app as the app's own origin, so the app's CSRF check accepts its own forms
and requests. Any other origin reaches the app unchanged, and the app refuses it as it would without
the proxy. The proxy never follows a redirect itself; the browser does. A redirect to the app's own
address keeps the page on the proxy, and a redirect to another site, such as a sign-in provider,
leaves for that site.

OAuth sign-in works with this. The provider sends the browser to the app's registered address, so
after sign-in the frame shows the app at its real address, without Visual Feedback, until the
preview is opened again. Where the app keeps sign-in state in local or session storage instead of a
cookie, a flow started on the proxied page cannot finish there. In the desktop app, **Open
directly** shows the page at its real address, outside the proxy, for flows like these.

In the desktop app on macOS and Linux, when the page you are using leaves for another site, such as
the provider's sign-in page, the tab becomes a native page at that address, without Visual Feedback,
so the sign-in shows inside Localix and returns to the app in the same tab. Links in the chat and
the rest of the app are not affected.

The probe and host UI establish a per-load `postMessage` channel. Turning Visual Feedback on sends a
mode change through that channel, so it does not reload a connected preview. A page reload creates a
new handshake; a comment being written survives it, and the new page is asked to find its element
again so the card follows it.

While commenting, the page receives no presses: clicks, mouse and touch presses stop at the probe,
so a control under the pointer is picked rather than operated. The probe draws in its own shadow
root above the page and re-measures on scroll, resize and DOM changes, so outlines and tints follow
layout shifts and re-rendered elements.

### Capture and source resolution

| Priority | Source mechanism                                                                         | Result                                                        |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1        | Source attributes such as `data-source-loc`, inspector attributes, or `data-source-file` | File, line, column, or component id when supplied             |
| 2        | React fiber `_debugSource` or the JSX `__source` property                                | File, line, column, and component when the dev build has them |
| 3        | The static entry file served by Localix                                                  | File-level fallback without a resolved line                   |

The capture also records a generated selector, readable DOM path, component ancestry when React
exposes it, nearby text, an identifying opening tag, and a compact computed-style snapshot. The host
captures each observation as a bounded Markdown snippet binding whose screenshot rides as a nested
asset, so the normal context pipeline budgets the note and its picture together. The message text
stays untouched and focus stays in the preview.

Picking an element opens a note card anchored to it, the way commenting on a sentence does. The note
is optional: the screenshot already identifies the element, so an empty note attaches "look at
this", and typing sharpens it. Selecting text needs no card or extra attach button: the words become
a comment immediately, bounded to 500 UTF-16 code units. Text quick-add captures no screenshot.

The composer's attached-context list is the one place an observation is reviewed and removed. Each
row expands to the full comment text and its screenshots, which open full size. Removing a row
removes the comment everywhere. On the page itself, every commented element carries one quiet tint —
the preview's version of a highlighted sentence. Text surfaces and the preview run the same
review-comment mechanism end to end.

Capture text is clamped before it reaches the agent. Secret-shaped tokens are replaced, and URL
credentials, queries, and fragments are removed. The host repeats this scrub when building the
message.

### Element screenshots

For an element pick, the probe rasterizes the element and surrounding page context into a JPEG. It
waits briefly for loaded web fonts, embeds them into the render, preserves the cloned page's own
background, and uses the nearest painted ancestor only as the JPEG alpha backdrop. The render
happens inside the preview page, so it does not request screen-capture permission or include the
surrounding Localix workspace. Probe outlines are filtered from the cloned DOM.

A shot of the page root is the VIEWPORT, not the document: it renders the root at window size,
offset by the current scroll. Rendering a long document instead was slow enough to exceed the
eight-second budget and return no picture at all, and a comment about the screen means the part of
it you can see.

### Server state

The preview shows whatever its URL returns. It does not watch the server, start it, or stop it: a
stopped server shows the browser's own error page until you start it again yourself and choose
**Reload page**.

## Configuration

If the **Live preview** introduction appears, choose **Just browse** to interact with the page or
**Visual Feedback** to select an element for an observation. You can change mode later in the
toolbar.

The compact browser toolbar keeps navigation and actions in one row. Enter an HTTP(S) address, a
local host and port, a relative route, or search text in **Browser address** and press Enter. Escape
discards address edits. Reload stays beside the address; Visual Feedback and the frame size form one
group on the right, dev-server ports and the external browser another. Tabs close from the tab
strip. Frame-size and port menus use separate aligned columns for names and dimensions.

Scrolling a selected element keeps the same comment draft and focus. The comment card adapts to the
available frame width; text context can be attached with keyboard activation as well as a pointer.
The attach action waits for screenshot preparation to finish.

Visual Feedback has no settings key. Its controls live in the preview toolbar; what has been
attached is reviewed in the composer's attached-context list.

| Control             | Effect                                                                 | Availability                                           |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| **Visual Feedback** | Toggles element selection without reloading a connected preview.       | Enabled when a probe is connected or can be loaded     |
| **Page frame size** | Chooses responsive fill, phone, tablet, laptop, or desktop dimensions. | Available on every page                                |
| **Rotate frame**    | Swaps the selected fixed width and height.                             | Hidden for responsive fill                             |
| **Attach feedback** | Attaches the observation as context, screenshot nested inside it.      | Requires a selected capture and session; note optional |
| **Open directly**   | Shows a proxied page at its real address, without Visual Feedback.     | Desktop app, on a page served through the proxy        |

| Preview input                 | Probe path                                                                | Boundary                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Static HTML served by Localix | The loopback static server injects the probe into the HTML response.      | Only files below the selected static root are served; dotfiles and dot-directories answer 404, except `/.well-known/`. |
| HTTP or HTTPS preview         | A loopback reverse proxy injects the probe and presents the app's origin. | Loopback upstreams only; the proxy removes CSP and frame-blocking headers.                                             |
| Frame-blocked preview         | The UI shows a blocked-state card and can engage the injecting proxy.     | Frame-busting script, bot protection, or an unreachable origin can still prevent use.                                  |

## Limits

- Source mapping is best-effort. Production React bundles and non-React pages may provide no
  file-and-line data; a Localix-served static file supplies only a file-level fallback.
- Element screenshots re-render DOM through a canvas path rather than copying compositor pixels.
  Cross-origin images without suitable CORS access can be omitted, and rasterization can fail.
- The redaction pass recognizes configured secret patterns; it is not a general classification
  system for every sensitive string visible in a page.
- Fixed frame sizes do not emulate a mobile user agent, device pixel ratio, touch input, sensors, or
  browser-specific rendering.
- The injecting proxy binds to loopback, forwards upstream cookies and request bodies, and removes
  CSP and frame-blocking response headers. Use it only with preview origins you trust.
- The proxied page has another origin than the app. A sign-in redirect returns to the app's real
  address, and state the app keeps in local or session storage is not shared between the two.
- Browsers block `SameSite=Lax` and `Strict` cookies in a frame whose site differs from the Localix
  window's, for example a `localhost` app while Localix runs on `127.0.0.1`. Sign-in then fails in
  the frame, with or without the proxy. Use **Open directly** in the desktop app.
- Hosted sign-in providers refuse to be framed. In the desktop app on macOS and Linux, a page you
  are using that navigates to one switches its tab to the native page at the provider's address, and
  the provider's redirect back lands in that tab. A page that redirects by itself, or a click made
  by the agent, asks before it opens the system browser. On Windows the frame shows the provider's
  refusal; use **Open directly**.
- The Localix API refuses every request that arrives through a preview proxy.
- A probe build or handshake failure leaves the page viewable but removes element picking and agent
  control from that preview.

## Related guides

- [Use the workspace](workspace.md)
- [Preview control internals](https://github.com/rsaryev/localix/blob/main/docs/internals/subsystems/preview-control.md)
- [Human in the loop](hitl.md)

## Source of truth

- [Selection gestures and text bound](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/selection/fsm.ts)
- [Probe capture](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/probe/capture.ts)
- [Layered source resolution](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/source/index.ts)
- [Capture redaction and limits](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/core/redact.ts)
- [Host bridge](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/useVisualFeedback.ts)
- [Comment batching](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/VisualFeedbackLayer.tsx)
- [Static and proxied probe injection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/preview/preview-probe.ts)
