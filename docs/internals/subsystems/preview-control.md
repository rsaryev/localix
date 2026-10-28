# Agent preview control

The `Browser` tool relays agent commands through a foreground or background native Preview host into
the Visual Feedback probe. Use this page when changing tool actions, preview opening, command
routing, tab identity, or probe delivery.

## Terminology

| Term              | Meaning                                                            | Boundary                                                              |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Drive action      | `click`, `type`, `press`, `scroll`, or `hover` in the preview page | The probe synthesizes DOM events; they are not trusted browser events |
| Read action       | `snapshot`, `take_screenshot`, `console`, or `evaluate`            | Reads come from the injected page realm, not an external browser      |
| Ref               | An `eN` handle assigned by the latest accessibility snapshot       | Navigation or DOM replacement can invalidate it                       |
| Relay             | API event, UI bus, iframe message, and websocket reply path        | A connected Localix application and page probe must answer            |
| Tab ID            | `preview_id`, derived from the session and the opened target       | The same origin or served folder always lands in the same tab         |
| Injecting proxy   | Loopback reverse proxy that adds the probe to upstream HTML        | It removes CSP and frame-blocking headers from proxied responses      |
| Recovery snapshot | Fresh tree attached to a stale-ref or covered-target result        | It updates refs; it does not make the failed action succeed           |

## What you can do

| Operation               | Mechanism                                                             | Boundary                                                                  |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Open a static file      | `openPreviewCore` serves the file from a loopback static server       | Model-supplied paths must remain inside the session workspace             |
| Open a running server   | The API probes an HTTP or HTTPS URL and publishes `preview.updated`   | A reachable response does not guarantee successful iframe rendering       |
| Close the preview       | The tool publishes `preview.closed` for the named tabs                | Close is tool-only, needs a tab ID and never enters the probe             |
| Read the rendered page  | The probe returns an accessibility tree, console tail, value, or JPEG | Screenshot rasterization uses DOM rendering rather than compositor pixels |
| Drive page controls     | The probe resolves a ref or selector and synthesizes the interaction  | `click`, `type`, and `hover` require an explicit target                   |
| Batch actions and reads | `steps` dispatches an ordered list inside one probe command           | Failure stops the batch after earlier effects have already happened       |

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

A command names its tab by `preview_id`. Nothing is remembered or reopened: if no probe answers, the
failure is reported as it is. The tool does not start an external headless browser or inspect an
arbitrary browser tab.

### Mini app views

A mini app's workbench view has no URL, so it is addressed as `mini-app:<name>`
(`apps/api/src/contracts/mini-app-view-target.ts`, parsed by both sides). `open` with that target
serves nothing and returns the target itself as the tab ID. The command then takes the relay above,
and stage 3 is `useMiniAppViewAgent`, which claims every `mini-app:*` command with the same claim
protocol as the other hosts. `apps/ui/src/features/inspector/model/miniAppViewHost.ts` runs it, in
this order:

| Step | Mechanism                                                                               | Boundary                                                               |
| ---: | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
|    1 | Refuse `evaluate` (alone or in `steps`) and `viewport`                                  | evaluate would run in the Localix window, not a page                   |
|    2 | Resolve the mini app's rail viewlet, else its only work-item kind                       | A mini app with no native UI answers `not_found` with the loaded views |
|    3 | Open the tab through `inspector.openWorkItem` unless it is already visible              | Found by `data-work-item-id` on the tab panel                          |
|    4 | Wait for a view it just opened to stop changing structure (300 ms quiet, 4 s cap)       | Text and attribute changes do not count, so a ticking view is quiet    |
|    5 | Run the command with `@localixai/visual-feedback/embedded`, scoped to the panel element | Selectors, refs, Tab order and screenshots stay inside the panel       |
|    6 | Name the snapshot and the screenshot after the view                                     | Not after the chat window around it                                    |

`console` reads the mini app's own buffer (`apps/ui/src/shared/contrib/miniAppViewErrors.ts`):
uncaught errors and console calls whose stack runs through the mini app's artifact, and render
crashes its tab's boundary catches. The screenshot backdrop is `--background-solid`, because under
the glass theme every pane is translucent. A sandboxed third-party view (an iframe) is outside the
panel's reach.

### Opening and target discovery

For a static file, `openPreviewCore` resolves the path against the session working directory,
enforces containment, starts or reuses a directory-scoped static server, and injects the probe into
HTML. For a URL, it requires HTTP or HTTPS, follows redirects during a 2.5-second liveness fetch,
and publishes the direct URL plus whether the site refuses framing.

The proxy forwards ordinary requests and HMR websockets. When nothing listens upstream it answers
502 with the upstream address; a reload shows the page once the server is up. The proxy is built
only for a loopback upstream (`localhost`, `127.0.0.1`, `[::1]`); `resolve` returns no `injectUrl`
for a remote site, so a remote page is never re-hosted on a loopback origin.

### Frame address

Both in-process preview servers (the static server and the injecting proxy) bind an ephemeral port
that dies with the API process, so no port is ever persisted or carried on the `preview.updated`
frame. The pane asks `POST /rpc/preview/resolve` (`features/preview/routes.ts`) for the current
address before it mounts a frame and again after every socket reconnect (the signal that the API
restarted); a re-served file that came back on a new port re-points the stored entry. When the API
cannot answer, the frame loads the URL as given. The UI half is
`apps/ui/src/features/inspector/ui/usePreviewEndpoint.ts`.

The pane does not track whether the page's own server is up. It shows whatever the URL returns; a
stopped server shows the browser's own error page, and the toolbar's reload remounts the frame.

A site that refuses framing is never mounted directly: the desktop shell's navigation guard hands a
non-loopback document in any frame to the system browser. The pane shows its card and mounts the
loopback strip-proxy only on request.

A terminal's served URL, shown on its tab and offered as "Open preview", comes from its own output:
`createServedUrlScanner` finalizes complete lines, strips terminal controls, validates URLs and
ranks candidates; only loopback or private hosts with explicit ports are admitted. Once seen, the
URL stays with the terminal. The agent opens a preview itself with `open`; nothing opens one from
terminal output. A URL, and a full-screen app entering or leaving the alternate screen, is pushed as
`terminal.state`; the terminal list is read once when a session opens and again after a reconnect.

### Recovery invariants

| Failure or ambiguity        | Mechanism                                                                                            | Result                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Stale ref                   | The ref registry retries once by saved selector, then unique role and accessible name                | Success includes a heal note and fresh tree; failure includes the fresh tree  |
| Covered click target        | Center-point hit testing identifies the covering element and searches its dialog for a close control | The `intercepted` error names the blocker, its close control and a fresh tree |
| Asynchronous page change    | Drive actions wait two animation frames and up to 400 ms for root animations                         | The default result contains a settled change diff                             |
| Page reload                 | A same-origin `sessionStorage` marker detects prior agent activity in the old probe realm            | The first new command reports that old refs are invalid                       |
| Handler or resource failure | The probe attaches action-time errors and newly failed subresources                                  | The agent receives the failure beside the triggering action                   |
| Native page dialog          | The probe replaces `alert`, `confirm`, and `prompt` with non-blocking recorded stubs                 | The bridge stays responsive and the action reports the dialog                 |

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

| Action            | Required input         | Optional input or default            | Boundary                                                                  |
| ----------------- | ---------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `open`            | `file_path` or `url`   | `background`, `viewport`             | Returns `preview_id` and separate probe readiness                         |
| `close`           | `preview_id(s)`        | None                                 | Closes only the named tabs                                                |
| `viewport`        | `viewport`             | `preview_id`                         | Integer CSS width/height 240–3840, or null for fill; actual size verified |
| `snapshot`        | None                   | None                                 | Assigns the current `eN` refs                                             |
| `take_screenshot` | None                   | `ref`; otherwise page body           | Model output drops images above 7 MiB of base64 text                      |
| `console`         | None                   | None                                 | Returns the captured ring-buffer contents                                 |
| `evaluate`        | Non-empty `expression` | `snapshot_after` defaults to `false` | Runs in the page realm and can mutate page state                          |
| `steps`           | Non-empty `steps`      | `snapshot_after` defaults to `false` | Interactions plus snapshot, evaluate, and console                         |
| `goal`            | Non-empty `goal`       | `values`: the only strings it types  | A decision model drives up to 20 actions; returns a trace and the page    |

Interactions are step shapes inside `steps`, not top-level actions:

| Step             | Required input            | Optional input or default                                           | Boundary                                        |
| ---------------- | ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `click`, `hover` | `ref` or `selector`       | —                                                                   | Center-point occlusion can block the action     |
| `type`           | Target and `text`         | —                                                                   | Replaces the field value and emits input events |
| `press`          | `key` or non-empty `keys` | Target; otherwise the element focused when each key is sent         | Keys run in the supplied order; Tab moves focus |
| `scroll`         | None                      | Target, direction defaults to down, amount defaults to 80% viewport | A target scrolls into view                      |

Interactions use the step shape inside `steps`; execution accepts the same vocabulary as the schema.
Old flat interactions are refused with a replacement one-step batch. Unknown fields such as `title`,
`interactiveOnly`, and `maxDepth` are rejected.

Set `action` explicitly. When omitted, `inferAction` accepts only an unambiguous signature:
`expression`, `steps`, `file_path`/`url`, or `viewport`. A bare `ref` names no action. Reference
normalization accepts `[ref=e3]`, `ref=e3`, and `#e3`.

A batch is checked whole before any of it runs: a targeting step without `ref` or `selector`, a
`press` step without keys, an `evaluate` step without an expression, or an empty `steps` array
returns a fix-it that names the step index, and nothing is relayed.

`take_screenshot` is the tool's name for the probe's `screenshot` command; the probe protocol keeps
its own name because the manual Visual Feedback picker sends it too, and `buildPreviewCommand` is
the one place the two vocabularies meet.

A returned screenshot outlives its turn. Any tool image (a screenshot, an image `Read`, an MCP
picture) is stored in the media store and recorded on the tool item as `attachments` (`mediaId`,
never inline base64) by `run/tool-result-media.ts`. On a later turn the media stage
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

### Goal-driven actions

`goal` hands a short sub-goal on the current tab to the decision service (`features/decisions`),
following [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast)'s operation-and-target
design. Each step reads one snapshot and asks one request with speculative heads: an `operation`
among those available now (CLICK, TYPE_TEXT, PRESS_ENTER right after typing, SCROLL_DOWN, SCROLL_UP,
WAIT, DONE, BLOCKED), and a target head for each operation over the snapshot's `elements`
(`click_target`, `type_target`, and `type_value` over the agent's `values`). Only the head of the
chosen operation executes, through the same relay commands `steps` uses. Disabled controls are never
offered as targets, and the model types only one of the supplied `values`. Page text is data for the
model, never instructions.

The loop stops on DONE or BLOCKED, a decision without answers, a relay error, the same action twice
with no visible change, 20 actions, or 40 decision requests. A target gone since the snapshot is
read again and decided again once per step. It returns one trace line per action and a fresh
snapshot. DONE is the model's judgement, not proof: the agent verifies the page itself. Spend is
recorded under **Decisions** with the purpose `browser.goal`. Without a decision model, or when a
probe returns no `elements`, the action says to use `steps`. The pure parts live in
`browser-goal-ask.ts`; the loop is `browser-goal.ts`.

The snapshot gives every field its label and its current value separately. For example,
`textbox "Where to?" = "London"`. Labels come from `aria-label`, `aria-labelledby`, an associated or
wrapping `<label>`, then placeholder, title and name. A password value is never read. States include
`expanded`/`collapsed`, `selected`, `required` and `readonly`. Beside the tree, the snapshot carries
`elements`: the interactive nodes in tree order (at most 250), with role, name, value, states, and
whether the node takes typing (`packages/visual-feedback/src/snapshot/field.ts`).

### Background hosts and command ownership

`preview.updated` and `preview.closed` reach connected clients regardless of their watched sessions.
`BackgroundPreviews.tsx` hosts a tab off screen only while an agent uses it: the agent opening it or
sending it a command starts the host, and the end of that session's run (`run.completed` or
`run.failed`) releases every off-screen host of its workspace, closing native pages too. The tab
stays in the strip, and persisted preview history starts nothing. Foreground hosts take over when
visible. A host change may reload the page: inspect state and obtain fresh refs before continuing
interactions. Child completion closes only previews the user has not opened.

The tool carries the preview id to the session-filtered relay. Before execution, a host claims the
command over `preview-result`; another host cannot claim it or submit its result. A host that
unmounts before executing releases its claim, and the release re-publishes the command: during a
takeover the visible tab claims while the hidden host still holds the command, is refused, and would
otherwise never see it again, so the command timed out as `host_unavailable`. Commands for one
user/origin are serialized because their frames share browser storage. Commands are live-only, never
replayed on socket reconnect; the client briefly buffers them only while a host mounts.

The viewport action changes the existing toolbar state and measures `window.innerWidth` and
`window.innerHeight` through the probe. Missing or mismatched measurements fail the check. The tool
remembers a fixed size per tab for the rest of the run and attaches it to every later command, so
whichever host claims a command (another window, a remounted pane) applies the same frame before
measuring. `viewport: null` and an `open` without a size clear it. A size the agent set is marked on
the tab, and the UI returns those tabs to fit-to-pane when the run completes or fails; a size the
person picked is kept.

A command whose `preview_id` names no tab in the workspace strip is answered after a short grace
period by a stand-in host in the UI with `not_found` and the open tab IDs and URLs, instead of
timing out as `host_unavailable`. A `take_screenshot` by ref in a document that has not snapshotted
yet numbers the page first, because the snapshot from `open` may have come from another renderer of
the same tab. Drive actions never do this, since after a reload the same ref can name a different
control. Unknown settings are rejected rather than silently ignored. This is layout resizing, not
device, user-agent, or touch emulation.

Diagnostics distinguish `app_disconnected`, `host_unavailable`, `probe_not_ready`, `timeout`, and
`frame_blocked`. New diagnostic failures are not automatically reopened and retried: an interaction
that timed out might already have executed. Required unperformed checks remain blocked.

### Runtime bounds

| Control                  |      Value | Owner                       |
| ------------------------ | ---------: | --------------------------- |
| Server relay timeout     | 22 seconds | Preview command registry    |
| UI probe-command timeout | 10 seconds | Visual Feedback host bridge |
| Proxy engagement wait    |  8 seconds | Preview tab                 |
| Snapshot after `open`    | 12 seconds | Browser tool                |
| Settle animation wait    |     400 ms | In-page actuator            |

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
- A terminal's served URL comes only from its own output, so a server that prints no URL supplies no
  target.
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
- [Static and URL opening](../../../apps/api/src/features/agent-core/tools/preview/open-preview.ts)
- [Probe build and injection](../../../apps/api/src/features/agent-core/tools/preview/probe-inject.ts)
- [Reverse proxy](../../../apps/api/src/features/agent-core/tools/preview/preview-proxy.ts)
- [Banner URL detection](../../../apps/api/src/features/agent-core/tools/preview/served-url-detect.ts)
- [Terminal service](../../../apps/api/src/features/terminal/service.ts)
- [UI relay](../../../apps/ui/src/features/inspector/ui/PreviewTab.tsx) ·
  [Visual Feedback bridge](../../../apps/ui/src/features/inspector/ui/useVisualFeedback.ts)
- [Probe protocol](../../../packages/visual-feedback/src/protocol/index.ts)
- [Actuation and recovery](../../../packages/visual-feedback/src/actuate/index.ts) ·
  [target recovery](../../../packages/visual-feedback/src/actuate/target.ts)
