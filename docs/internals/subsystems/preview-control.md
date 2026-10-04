# Agent preview control

The `browser` tool relays agent commands through a foreground or background native Preview host into
the Visual Feedback probe. Use this page when changing tool actions, preview opening, command
routing, target recovery, or probe delivery.

## Terminology

| Term              | Meaning                                                            | Boundary                                                              |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Drive action      | `click`, `type`, `press`, `scroll`, or `hover` in the preview page | The probe synthesizes DOM events; they are not trusted browser events |
| Read action       | `snapshot`, `take_screenshot`, `console`, or `evaluate`            | Reads come from the injected page realm, not an external browser      |
| Ref               | An `eN` handle assigned by the latest accessibility snapshot       | Navigation or DOM replacement can invalidate it                       |
| Relay             | API event, UI bus, iframe message, and websocket reply path        | A connected Localix application and page probe must answer            |
| Preview target    | Per-session URL, title, start command, and opened state            | The process-local registry retains at most 256 targets                |
| Injecting proxy   | Loopback reverse proxy that adds the probe to upstream HTML        | It removes CSP and frame-blocking headers from proxied responses      |
| Recovery snapshot | Fresh tree attached to a stale-ref or covered-target result        | It updates refs; it does not make the failed action succeed           |

## What you can do

| Operation                    | Mechanism                                                                                                                    | Boundary                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Open a static file           | `openPreviewCore` serves the file from a loopback static server                                                              | Model-supplied paths must remain inside the session workspace                                                         |
| Open a running server        | The API probes an HTTP or HTTPS URL and publishes `preview.updated`                                                          | A reachable response does not guarantee successful iframe rendering                                                   |
| Close the preview            | The tool publishes `preview.closed` and clears the remembered target                                                         | Close is tool-only and never enters the probe                                                                         |
| Read the rendered page       | The probe returns an accessibility tree, console tail, value, or JPEG                                                        | Screenshot rasterization uses DOM rendering rather than compositor pixels                                             |
| Drive page controls          | The probe resolves a ref or selector and synthesizes the interaction                                                         | `click`, `type`, and `hover` require an explicit target                                                               |
| Batch actions and reads      | `steps` dispatches an ordered list inside one probe command                                                                  | Failure stops the batch after earlier effects have already happened                                                   |
| Open a detected dev server   | A background terminal records its advertised URL and the preview opens by push, the way a spawned PTY opens its terminal tab | Only runs whose profile exposes `browser` open; a failed liveness probe is retried once, then left to the first drive |
| Reopen a detected dev server | A remembered target that never opened is opened on the first drive action                                                    | Foreground commands do not register a lazy preview target                                                             |

The user-facing picker, source capture, comments, screenshots, and responsive frame controls belong
to [Visual Feedback](../../features/visual-feedback.md).

## How it works

### Command relay

The tool is registered only for a client surface with the `workbench-ui` capability. Open and close
remain API-side operations; every other action follows this route:

| Stage | Owner | Mechanism                                              | Failure boundary                                |
| ----: | ----- | ------------------------------------------------------ | ----------------------------------------------- |
|     1 | Tool  | `browser.ts` builds one flat `PreviewCommand`          | Missing action fields fail before relay         |
|     2 | API   | `PreviewCommandRegistry` publishes `preview.command`   | The default reply timeout is 22 seconds         |
|     3 | UI    | `previewControlBus` routes by session to `PreviewTab`  | A tab can wait 8 seconds for probe engagement   |
|     4 | Probe | `postMessage` dispatches against the live iframe DOM   | The host command wait is 10 seconds             |
|     5 | API   | The UI sends `preview-result` over the event websocket | Resolution is checked against the command owner |

If no probe answers, the tool can reopen the remembered URL and retry once. It does not start an
external headless browser or inspect an arbitrary browser tab.

### Plugin views

A plugin's workbench view has no URL, so it is addressed as `plugin:<name>`
(`apps/api/src/contracts/plugin-view-target.ts`, parsed by both sides). `open` with that target
serves nothing: `run/browser-options.ts` only records it as the session's target. The command then
takes the relay above, and stage 3 is `usePluginViewAgent`, which claims every `plugin:*` command
with the same claim protocol as the other hosts.
`apps/ui/src/features/inspector/model/pluginViewHost.ts` runs it, in this order:

| Step | Mechanism                                                                               | Boundary                                                             |
| ---: | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|    1 | Refuse `evaluate` (alone or in `steps`) and `viewport`                                  | evaluate would run in the Localix window, not a page                 |
|    2 | Resolve the plugin's rail viewlet, else its only work-item kind                         | A plugin with no native UI answers `not_found` with the loaded views |
|    3 | Open the tab through `inspector.openWorkItem` unless it is already visible              | Found by `data-work-item-id` on the tab panel                        |
|    4 | Wait for a view it just opened to stop changing structure (300 ms quiet, 4 s cap)       | Text and attribute changes do not count, so a ticking view is quiet  |
|    5 | Run the command with `@localixai/visual-feedback/embedded`, scoped to the panel element | Selectors, refs, Tab order and screenshots stay inside the panel     |
|    6 | Name the snapshot and the screenshot after the view                                     | Not after the chat window around it                                  |

`console` reads the plugin's own buffer (`apps/ui/src/shared/contrib/pluginViewErrors.ts`): uncaught
errors and console calls whose stack runs through the plugin's artifact, and render crashes its
tab's boundary catches. The screenshot backdrop is `--background-solid`, because under the glass
theme every pane is translucent. A sandboxed third-party view (an iframe) is outside the panel's
reach.

### Opening and target discovery

For a static file, `openPreviewCore` resolves the path against the session working directory,
enforces containment, starts or reuses a directory-scoped static server, and injects the probe into
HTML. For a URL, it requires HTTP or HTTPS, follows redirects during a 2.5-second liveness fetch,
and publishes the direct URL plus whether the site refuses framing.

The proxy forwards ordinary requests and HMR websockets. Top-level navigation retries connection
failures for up to four seconds, then serves a one-second-refreshing waiting page. Subresources do
not use that readiness retry.

### Frame address and server liveness

Both in-process preview servers (the static server and the injecting proxy) bind an ephemeral port
that dies with the API process, so no port is ever persisted or carried on the `preview.updated`
frame. The pane asks `POST /rpc/preview/resolve` (`features/preview/routes.ts`) for the current
address before it mounts a frame, again after every socket reconnect (the signal that the API
restarted), and once when liveness flips to down for a file the API serves itself; a re-served file
that came back on a new port re-points the stored entry. The UI half is
`apps/ui/src/features/inspector/ui/usePreviewEndpoint.ts`.

Whether the page's own server is up is the API's answer, pushed over the socket:
`features/liveness/preview-liveness.ts` watches one loopback or private endpoint per machine with a
TCP connect through `@localixai/liveness`, and the terminal service reports a spawned dev server's
exit. A "down" report about a probe-able endpoint is verified by one immediate probe before it is
published, so a port scan that missed a listener for one pass cannot flip the pane. An endpoint the
API declines to watch answers `watchable: false`, and only then does the pane poll it with a
cache-bypassing `no-cors` fetch (`apps/ui/src/features/inspector/model/previewPing.ts`).

A site that refuses framing is never mounted directly: the desktop shell's navigation guard hands a
non-loopback document in any frame to the system browser. The pane shows its card and mounts the
loopback strip-proxy only on request.

Lazy targets have two terminal-owned evidence paths:

| Source      | Mechanism                                                                                                         | Boundary                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| PTY banner  | `createServedUrlScanner` finalizes complete lines, strips terminal controls, validates URLs, and ranks candidates | Only loopback or private hosts with explicit ports are admitted |
| OS listener | `scanListeningPorts` maps a listener PID and working directory to a terminal session                              | Implemented for macOS and Linux; lowest attributed port wins    |

A recorded target also keeps the background command whose output advertised the URL. Detection stays
content-based; the command travels as provenance, and it is what the preview pane reruns when its
server stops. Re-detecting the same origin keeps a command a later banner line omits.

The terminal service refreshes listener evidence at most once per 2.5 seconds when terminal rows are
listed, and callers that arrive while a scan runs share it
([`port-scan-cache.ts`](../../../apps/api/src/features/terminal/port-scan-cache.ts)). Scan-derived
URLs disappear when their listener dies; banner-derived URLs remain latched. Either change, and a
full-screen app entering or leaving the alternate screen, is pushed as `terminal.state`, so the
composer's "Open preview" and the terminal auto-reveal do not wait for its registry poll; that poll
(every 20 seconds while terminals are live) remains the only source of a banner-less listener and
the baseline after a reconnect. Only the background bash path subscribes to `onPreviewUrl`. It
records the session target and, when the run can preview at all, opens it at once
(`run/preview-auto-open.ts`); the bind-all banners `0.0.0.0` and `[::]` both normalize to
`localhost`.

### Recovery invariants

| Failure or ambiguity        | Mechanism                                                                                            | Result                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stale ref                   | The ref registry retries once by saved selector, then unique role and accessible name                | Success includes a heal note and fresh tree; failure includes the fresh tree |
| Covered click target        | Center-point hit testing identifies the covering element and searches its dialog for a close control | The `intercepted` error includes dismissal guidance and a fresh tree         |
| Asynchronous page change    | Drive actions wait two animation frames and up to 400 ms for root animations                         | The default result contains a settled change diff                            |
| Page reload                 | A same-origin `sessionStorage` marker detects prior agent activity in the old probe realm            | The first new command reports that old refs are invalid                      |
| Handler or resource failure | The probe attaches action-time errors and newly failed subresources                                  | The agent receives the failure beside the triggering action                  |
| Native page dialog          | The probe replaces `alert`, `confirm`, and `prompt` with non-blocking recorded stubs                 | The bridge stays responsive and the action reports the dialog                |

Drive actions return a compact change diff by default. `snapshot_after: true` returns the full fresh
tree when the next action needs new refs. A self-healed action returns a tree regardless of that
flag.

### Probe delivery

`probe-inject.ts` reads a packaged probe asset when available; source runs bundle
`@localixai/visual-feedback/probe-entry` into a browser IIFE. Concurrent callers share one build.
Under `bun --watch` or `bun --hot`, the cache rebuilds when non-test TypeScript source in the Visual
Feedback package has a newer modification time.

A build or resolution failure logs one warning and serves the HTML without the probe. The page can
remain visible, but Visual Feedback and agent control cannot connect.

## Configuration

### Action contract

| Action            | Required input         | Optional input or default                 | Boundary                                                                  |
| ----------------- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `open`            | `file_path` or `url`   | `start_command`, `background`, `viewport` | Returns `preview_id` and separate probe readiness                         |
| `close`           | None                   | `preview_id`                              | Without an ID, closes all previews owned by this session                  |
| `viewport`        | `viewport`             | `preview_id`                              | Integer CSS width/height 240–3840, or null for fill; actual size verified |
| `snapshot`        | None                   | None                                      | Assigns the current `eN` refs                                             |
| `take_screenshot` | None                   | `ref`; otherwise page body                | Model output drops images above 7 MiB of base64 text                      |
| `console`         | None                   | None                                      | Returns the captured ring-buffer contents                                 |
| `evaluate`        | Non-empty `expression` | `snapshot_after` defaults to `false`      | Runs in the page realm and can mutate page state                          |
| `steps`           | Non-empty `steps`      | `snapshot_after` defaults to `false`      | Interactions plus snapshot, evaluate, and console                         |

Interactions are step shapes inside `steps`, not top-level actions:

| Step             | Required input            | Optional input or default                                           | Boundary                                        |
| ---------------- | ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `click`, `hover` | `ref` or `selector`       | —                                                                   | Center-point occlusion can block the action     |
| `type`           | Target and `text`         | —                                                                   | Replaces the field value and emits input events |
| `press`          | `key` or non-empty `keys` | Target; otherwise the element focused when each key is sent         | Keys run in the supplied order; Tab moves focus |
| `scroll`         | None                      | Target, direction defaults to down, amount defaults to 80% viewport | A target scrolls into view                      |

The schema carries the interaction vocabulary once, in the step shape, and execute accepts exactly
what the schema declares. The old flat form (`action: "click", ref: "e3"`, or step fields such as
`text` at top level with no action) is refused before validation with the one-step `steps` call
built from the model's own fields, because the validator's own refusal ("must be equal to one of the
allowed values") does not say where interactions went. `title`, `interactiveOnly` and `maxDepth` are
not part of the schema and are refused as unknown fields. The input schema allows an omitted action
only when `inferAction` finds one unambiguous signature (`expression`, `steps`, `file_path`/`url`,
`viewport`); a bare `ref` names no action. Callers should still set the action explicitly. Ref
normalization accepts copied forms such as `[ref=e3]`, `ref=e3`, and `#e3`.

A batch is checked whole before any of it runs: a targeting step without `ref` or `selector`, a
`press` step without keys, an `evaluate` step without an expression, or an empty `steps` array
returns a fix-it that names the step index, and nothing is relayed.

`take_screenshot` is the tool's name for the probe's `screenshot` command; the probe protocol keeps
its own name because the manual Visual Feedback picker sends it too, and `buildPreviewCommand` is
the one place the two vocabularies meet.

A returned screenshot outlives its turn. Any tool image (a screenshot, `view_image`, an MCP picture)
is stored in the media store and recorded on the tool item as `attachments` (`mediaId`, never inline
base64) by `run/tool-result-media.ts`. On a later turn the media stage
(`history/stages/tool-images.ts`) puts the bytes back on the wire copy when the model reads images,
only for the newest result of each `supersedeKey`; older screenshots collapse to a recovery pointer,
picture included. A model that cannot read images is told the image is not included rather than sent
it. The tool card shows the stored picture, and the label the tool wrote travels with the image
instead of being replaced by it.

The rewrites that remain correct recorded mistakes on the current schema: a trailing
`take_screenshot` step becomes the call's `take_screenshot` action, a page URL passed as
`preview_id` becomes its origin, the only identity a host matches, and `action: "step"` maps to
`steps`. They live in `rewriteBrowserArguments` (`browser-lift.ts`). `prepareBrowserArguments` runs
the refusal and then the rewrites as the tool's `prepareArguments`, which the runtime calls before
it validates the JSON schema; a throw there becomes the call's error result. The zod `z.preprocess`
alone never ran on the dispatch path, so the lifts were refused in production while their unit tests
passed.

Synthesized key events are untrusted, so the browser runs no default action for them. `pressKey`
therefore performs Tab's sequential focus move itself when the page did not prevent it; a focus trap
that handles Tab keeps control. Without this, every focus check read `document.activeElement` as the
body.

### Background hosts and command ownership

`preview.updated` and `preview.closed` reach connected clients regardless of their watched sessions.
`BackgroundPreviews.tsx` mounts at most eight live off-screen hosts; persisted preview history alone
does not start them. Foreground hosts take over when visible. A host change may reload the page:
inspect state and obtain fresh refs before continuing interactions. Child completion closes only
previews the user has not opened.

The tool carries the preview id to the session-filtered relay. Before execution, a host claims the
command over `preview-result`; another host cannot claim it or submit its result. A host that
unmounts before executing releases its claim, and the release re-publishes the command: during a
takeover the visible tab claims while the hidden host still holds the command, is refused, and would
otherwise never see it again, so the command timed out as `host_unavailable`. Commands for one
user/origin are serialized because their frames share browser storage. Commands are live-only, never
replayed on socket reconnect; the client briefly buffers them only while a host mounts.

The viewport action changes the existing toolbar state and measures `window.innerWidth` and
`window.innerHeight` through the probe. Missing or mismatched measurements fail the check. Unknown
settings are rejected rather than silently ignored. This is layout resizing, not device, user-agent,
or touch emulation.

Diagnostics distinguish `app_disconnected`, `host_unavailable`, `probe_not_ready`, `timeout`, and
`frame_blocked`. New diagnostic failures are not automatically reopened and retried: an interaction
that timed out might already have executed. Required unperformed checks remain blocked.

### Runtime bounds

| Control                    |       Value | Owner                       |
| -------------------------- | ----------: | --------------------------- |
| Server relay timeout       |  22 seconds | Preview command registry    |
| UI probe-command timeout   |  10 seconds | Visual Feedback host bridge |
| Proxy engagement wait      |   8 seconds | Preview tab                 |
| Snapshot after `open`      |  12 seconds | Browser tool                |
| Settle animation wait      |      400 ms | In-page actuator            |
| Port-scan reuse window     | 2.5 seconds | Terminal service            |
| Remembered preview targets |         256 | Preview target registry     |

## Limits

- Drive and read actions require a connected Localix application with a foreground or background
  Preview host and a connected probe. An API-only headless run cannot complete the iframe relay.
- Synthesized pointer, mouse, keyboard, and input events have `isTrusted === false`. Controls that
  require trusted user activation can reject them.
- Static-file previews do not hot-reload. Opening the same file again increments the preview version
  and reloads its iframe.
- Every successful `open` increments the version, including an identical target. Redundant opens
  reset page state and probe refs.
- The injecting proxy removes CSP and frame-blocking headers and forwards cookies and request
  bodies. Bot protection, frame-busting scripts, or an unreachable upstream can still prevent use.
- Probe dialog handling changes preview behavior: `confirm` returns `true`, `prompt` returns `null`,
  and `alert` returns immediately while the probe is mounted.
- A single `evaluate` that mutates state and immediately reads it can run before an asynchronous
  framework commit. Use separate `steps` entries for act-then-read behavior.
- Between `steps` entries the probe waits two frames for the commit; the transition wait and the
  change diff run once, after the last entry. Settling after every entry cost about a second per key
  press, so a batch of ten presses overran the 10 s command cap after its moves had run.
- OS listener discovery is best-effort and unsupported outside macOS and Linux. Banner detection can
  still supply a target on other platforms.
- Screenshot output is an in-page rasterization. Cross-origin image restrictions and unsupported CSS
  can omit pixels or make capture fail; see [Visual Feedback](../../features/visual-feedback.md).

## Related guides

- [Visual Feedback](../../features/visual-feedback.md)
- [Use the workspace](../../features/workspace.md)
- [Architecture](../architecture.md)
- [Execution environments](../../features/execution-environments.md)

## Source of truth

- [Tool schema and inference](../../../apps/api/src/features/agent-core/tools/browser/browser-input.ts)
- [Tool execution and relay](../../../apps/api/src/features/agent-core/tools/browser/browser.ts)
- [Reply shaping](../../../apps/api/src/features/agent-core/tools/browser/browser-reply.ts)
- [Relay boundary types](../../../apps/api/src/features/agent-core/tools/preview/preview-control.ts)
- [Open, close, and target wiring](../../../apps/api/src/features/chat/runtime/run/browser-options.ts)
- [Command relay and ownership](../../../apps/api/src/features/chat/runtime/preview-command-registry.ts)
- [Remembered targets](../../../apps/api/src/features/chat/runtime/preview-target-registry.ts)
- [Static and URL opening](../../../apps/api/src/features/agent-core/tools/preview/open-preview.ts)
- [Probe build and injection](../../../apps/api/src/features/agent-core/tools/preview/probe-inject.ts)
- [Reverse proxy](../../../apps/api/src/features/agent-core/tools/preview/preview-proxy.ts)
- [Banner URL detection](../../../apps/api/src/features/agent-core/tools/preview/served-url-detect.ts)
- [Listener discovery](../../../apps/api/src/features/terminal/port-scan.ts) ·
  [terminal service](../../../apps/api/src/features/terminal/service.ts)
- [UI relay](../../../apps/ui/src/features/inspector/ui/PreviewTab.tsx) ·
  [Visual Feedback bridge](../../../apps/ui/src/features/inspector/ui/useVisualFeedback.ts)
- [Probe protocol](../../../packages/visual-feedback/src/protocol/index.ts)
- [Actuation and recovery](../../../packages/visual-feedback/src/actuate/index.ts) ·
  [target recovery](../../../packages/visual-feedback/src/actuate/target.ts)
