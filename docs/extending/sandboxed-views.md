# Build a sandboxed HTML view

Declare a `views` entry in the mini app's `mini-app.json`, pointing to an HTML file inside the mini
app's folder. Each view opens as a work-item tab from its rail button or the command palette. There
is no second placement; a legacy `surface` key is dropped. HTML views work for installed and bundled
mini apps, with `sandbox="allow-scripts"` and an opaque origin. They use the message bridge rather
than native React registrations or host UI-kit imports.

## Acquire the bridge

The host injects `acquireLocalixApi()` before the mini app's HTML runs. Acquire it once per
document; a second acquisition throws. The returned client is frozen and speaks protocol version 1.
The host accepts bridge messages only from the document it built for the view: each carries a
per-document key that the injected client adds. A page the frame navigates to, or a hand-written
`postMessage` envelope, is ignored.

```html
<script type="module">
  const localix = acquireLocalixApi()
  localix.onEvent((event) => console.log(event.name, event.data))
  localix.ready()

  const context = await localix.invoke('getContext')
  const state = (await localix.getState()) || {}
  await localix.setState({ ...state, lastSession: context.sessionId })
</script>
```

`ready()` opts into live theme and safe session-lifecycle messages. Theme variables are applied
automatically. Without that opt-in, a theme change can remount the static document. File changes,
file paths, and tool I/O are not lifecycle events;
[native UI](mini-app-ui.md#files-that-change-under-a-chat) has its own file subscription.

The built-in actions are `ping`, `sendPrompt`, `getContext`, `getViewState`, `setViewState`,
`callBackend`, and `publishMessageContext`. An unavailable capability rejects. `sendPrompt` targets
the chat owning the view's tab, even after the visible chat changes, and requires non-empty text and
a session. Context publication is normalized by the SDK; the iframe cannot choose its active-tab
provenance.

## Call your backend

Return the handler under the backend's `uiActions` from `register()`. There is no manifest mirror.
This example assumes the mini app is named `sample`:

```ts
import type { MiniAppRegistration } from '@localixai/mini-app-sdk/backend'

export function register(): MiniAppRegistration {
  return {
    backend: {
      id: 'sample:ui',
      uiActions: {
        loadDashboard: (_payload, context) => ({ viewId: context.viewId }),
      },
    },
  }
}
```

The view can then call `await localix.callBackend('loadDashboard', { page: 1 })`. The handler gets
host-bound `{ userId, projectId, sessionId?, viewId, cwd }`. The iframe cannot choose another mini
app or forge those fields through the payload. The API checks that the exact mini app and project
scope is enabled and that a supplied session belongs to the user. Duplicate handlers in one scope
reject as ambiguous; inherited property names do not resolve as actions.

## Limits and persistence

| Contract                   | Current boundary                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Client pending requests    | At most 128 at once                                                                                 |
| Client response wait       | 15 seconds by default; `invoke`/`callBackend` options accept `timeoutMs`, clamped to 100–120,000 ms |
| Backend UI handler wait    | 15 seconds independently of the client option                                                       |
| Backend request and result | JSON-serializable, each at most 256 KiB of encoded UTF-8 JSON                                       |
| Scratch state              | JSON in browser local storage, at most 65,536 serialized UTF-16 code units                          |

Timeouts stop waiting; they do not cancel the native handler or undo its side effects. A retry can
repeat a mutation. Design mutating actions around your own operation IDs or an explicit status check
when that matters. Native backend code still runs in process and is unsandboxed.

Scratch state is keyed by mini app name and view name, shared across projects and sessions in that
browser storage context. It survives remounts but is not server synchronization or secure secret
storage. Disabled storage, corrupt JSON, or quota failure can lose persistence; a successful
`setState` response does not guarantee a durable storage write.

## Document policy

Fetch, XHR, and WebSocket connections are blocked by `connect-src 'none'`. Scripts/styles may load
from `cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, and `unpkg.com`; HTTPS images are also
allowed. This is not a blanket network ban. Fonts use data URLs, media uses data/blob URLs, and
nested frames, forms, and base URLs are blocked. The desktop shell's CSP also applies, so its policy
can further restrict a resource.

The host forwards visual preferences inside the document. Reduced motion makes CSS animation,
transitions, and smooth scrolling instant. Increased contrast, reduced transparency, and forced
colors also apply. JavaScript animation should read and subscribe to the iframe's own
`matchMedia('(prefers-reduced-motion: reduce)')`.

## Related guides

- [Mini app authoring](mini-apps.md)
- [Native workbench UI](mini-app-ui.md)
- [Route request validation](mini-app-routes.md)

## Source of truth

- [Document sandbox and CSP](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/miniAppPanelSrcDoc.ts)
- [Injected client](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/miniAppUiApiBootstrap.ts)
- [Host action table](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/contrib/miniAppPanelActions.ts)
- [Scratch state](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/miniAppViewState.ts)
- [Backend authorization and payload limits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/service-ui.ts)
- [Backend handler dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/backend-host-ui-actions.ts)
