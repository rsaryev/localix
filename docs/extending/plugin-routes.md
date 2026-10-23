# Validate plugin route requests

Use `routeValidator` from `@localixai/mini-app-sdk/backend` to check a route's body, query or path
against a Zod schema before its handler runs. Build it once with the error envelope your UI client
reads, then attach it to routes that need input validation. A rejected schema returns a readable
400; validation does not run on routes where the middleware is absent.

## Terminology

| Term      | Meaning                                                               | Boundary                                           |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| Validator | `validated(target, schema)`, the middleware `routeValidator` returns. | Targets are `json`, `query` and `param`.           |
| Envelope  | The JSON shape a rejected request answers with.                       | One per router, chosen to match its UI client.     |
| Summary   | The failure text, built by `summarizeZodIssues`.                      | First issue in the headline; all issues in detail. |

## What you can do

```ts
import { routeValidator } from '@localixai/mini-app-sdk/backend'

const validated = routeValidator({ envelope: 'flat', code: 'invalid_request' })
app.post('/items', validated('json', itemSchema), (c) => c.json(save(c.req.valid('json'))))
```

| Envelope           | A rejected request answers                   | Read by                                  |
| ------------------ | -------------------------------------------- | ---------------------------------------- |
| `nested` (default) | `{ error: { code, message, detail } }`       | The SDK client's `unwrapPluginResponse`  |
| `flat`             | `{ error, code, detail }`                    | Clients that branch on a typed `code`    |
| `text`             | `{ error }`, one sentence naming every field | Clients that read `error` as the message |

`c.req.valid(target)` is typed from the schema, and a typed `hc` client keeps its request types.

## How it works

A validation failure answers the request itself instead of throwing, so it never reaches the
router's `onError`. Without a hook that formats it, the client receives Zod's raw issue array as its
error message and shows JSON to the person. `routeValidator` puts that hook in one place:
`summarizeZodIssues` builds the headline, the per-field detail and a message that names every failed
field. Nested and flat envelopes use the first issue as their headline and include every issue in
`detail`; the text envelope adds the failed field names to its sentence.

The handler receives the schema's parsed output, including coercions and defaults. Unknown-field
behavior belongs to the schema: a normal Zod object strips extra keys; use a strict schema when they
must be rejected. Validation does not add ownership checks or permission policy to the handler.

For JSON input, send `Content-Type: application/json`. Hono supplies an empty object to the
validator when the content type is absent or not JSON, so an all-optional schema can accept it.
Require the JSON content type separately when the route must reject that case. Malformed JSON fails
before schema validation and can return Hono's plain-text 400 instead of the chosen envelope;
clients must handle transport/parsing errors as well as structured schema errors.

## Read the request scope

Type contributed Hono apps with `PluginRouteContext` and read scope from `c.env`, including
`userId`, `cwd` and the optional `sessionId`. Host context variables such as `c.get('userId')` are
not forwarded to the contributed app. The host includes `sessionId` only after its live-session
ownership check succeeds; a foreign, missing or deleted session leaves it absent. A session-owned
route must reject that absence before accessing its storage.

## Limits

- Do not import `@hono/zod-validator` or `hono/validator` in a plugin. The repository guard
  `apps/api/src/lib/validator.test.ts` fails a bundled plugin that does.
- The envelope is a promise to the plugin's UI client. Change it only together with the client that
  reads it.
- An unanswered 404 before the first backend reconcile waits up to 15 seconds, then dispatches once
  more. Core responses do not wait. After that first reconcile settles, including failure, unknown
  routes return 404 immediately; the wait does not guarantee that a backend was loaded successfully.
- The global scope loads first, then project scopes load concurrently. A project that misses its
  1.5-second budget is left out of that pass; its eventual completion requests another reconcile.
  The timeout does not cancel the scan, and a scope failing within the budget can fail the pass.

## Related guides

- [Plugins](plugins.md)
- [Plugin UI](plugin-ui.md)

## Source of truth

- [The helper](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/route-validator.ts)
- [The failure summary](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/http.ts)
- [The guard](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/validator.test.ts)
- [Contributed route environment](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/http.ts)
- [Request scope resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/route-scope.ts)
- [First-reconcile wait](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/plugin-route-boot-hold.ts)
- [Project-scope load budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/scope-load.ts)
