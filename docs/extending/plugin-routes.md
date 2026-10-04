# Validate plugin route requests

A plugin router checks each request's body, query or path against a Zod schema before the handler
runs, and answers a bad one with a readable 400. `routeValidator` from
`@localixai/plugin-sdk/backend` is the one way to do that. You build it once with the error envelope
your UI client reads, then put it on each route. Every bundled plugin uses it.

## Terminology

| Term      | Meaning                                                               | Boundary                                        |
| --------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Validator | `validated(target, schema)`, the middleware `routeValidator` returns. | Targets are `json`, `query` and `param`.        |
| Envelope  | The JSON shape a rejected request answers with.                       | One per router, chosen to match its UI client.  |
| Summary   | The failure text, built by `summarizeZodIssues`.                      | Names every failed field; never Zod's raw dump. |

## What you can do

```ts
import { routeValidator } from '@localixai/plugin-sdk/backend'

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
field, so one retry can fix all of them.

## Limits

- Do not import `@hono/zod-validator` or `hono/validator` in a plugin. The repository guard
  `apps/api/src/lib/validator.test.ts` fails a bundled plugin that does.
- The envelope is a promise to the plugin's UI client. Change it only together with the client that
  reads it.
- A request that reaches a plugin route before the host has first wired the plugin backends waits
  for that wiring, up to 15 seconds, instead of answering 404. After the first wiring a 404 is
  immediate, so a UI that treats 404 as "not available" is still correct.
- Project scopes load concurrently. A project whose directory does not answer within 1.5 seconds (a
  macOS folder-access prompt nobody has answered yet) is wired on the next pass, as soon as it does,
  instead of holding back every other project's plugins.

## Related guides

- [Plugins](plugins.md)
- [Plugin UI](plugin-ui.md)

## Source of truth

- [The helper](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/route-validator.ts)
- [The failure summary](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/http.ts)
- [The guard](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/validator.test.ts)
