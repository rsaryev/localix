# Send messages into a session

The inbound webhook posts external text into an existing Localix chat session. Use it to deliver a
CI result, monitoring event, script output, or external worker report without typing in the
composer.

**Trust boundary:** The endpoint has no authentication, signature, replay protection, or shared
secret. The default server bind is loopback; changing `HOST` can expose the same endpoint more
widely.

## What you can do

| Need                            | Mechanism                                                                 | Boundary                                                                  |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Start a session turn            | `POST /rpc/webhook/messages` with a session id and prompt.                | The target must be a mutable chat session owned by the resolved user.     |
| Label the caller                | Add the optional `source` string to the request.                          | The caller controls this label; it is provenance, not verified identity.  |
| Deliver while a run is active   | The chat service queues the webhook as a priority-zero turn.              | The success response has an empty `messageId` until the queued turn runs. |
| Distinguish external input      | The service persists a hidden user row with wake source `external`.       | The UI shows the provenance on the assistant reply, not as a user bubble. |
| Give the model explicit context | The route prefixes the prompt with an external-message provenance line.   | The supplied prompt and source remain model-visible instructions.         |
| Discover the current address    | Runtime context includes the resolved webhook URL and current session id. | The address is for this running backend instance.                         |

## How it works

The route validates the JSON body, wraps the text with one provenance line, and calls the same chat
service entry used by the frontend. Slash commands, plugin commands, skills, reference expansion,
and busy-session queuing therefore run in the chat service rather than in a webhook-specific
dispatcher.

An idle target starts a turn immediately. A busy target enqueues the text with source `external`;
the queue drains it ahead of lower-priority loop wakes. Both paths keep the triggering user row out
of the visible transcript and associate the next visible assistant reply with **External**
provenance.

The backend derives the URL from `HOST`, `PORT`, and the canonical webhook path. Wildcard bind
addresses are converted to `127.0.0.1` in the address handed to same-machine callers.

| Outcome                    | HTTP status | Response behavior                                              |
| -------------------------- | ----------- | -------------------------------------------------------------- |
| Accepted on an idle target | `200`       | `queued` is `false`; `messageId` identifies the started turn   |
| Accepted on a busy target  | `200`       | `queued` is `true`; `messageId` is an empty string             |
| Invalid JSON fields        | `400`       | The validator rejects the request before chat delivery         |
| Chat service rejection     | `409`       | `error.code` is `webhook_send_failed` with the service message |

## Configuration

### Request

| Field       | Required | Constraint                 | Meaning                                                                      |
| ----------- | -------- | -------------------------- | ---------------------------------------------------------------------------- |
| `sessionId` | Yes      | Non-empty string           | Existing chat session to receive the turn                                    |
| `prompt`    | Yes      | 1–65,536 UTF-16 code units | Model-visible external message                                               |
| `source`    | No       | At most 120 characters     | Unverified caller label shown as provenance                                  |
| `x-user-id` | No       | Trimmed when present       | Self-asserted user scope; omission or blank uses the configured default user |

```bash
curl --request POST http://127.0.0.1:5051/rpc/webhook/messages \
  --header 'content-type: application/json' \
  --data '{"sessionId":"SESSION_ID","prompt":"Deployment finished. Verify the health check.","source":"ci"}'
```

### Response

```json
{
  "ok": true,
  "sessionId": "SESSION_ID",
  "messageId": "MESSAGE_ID",
  "queued": false
}
```

| Environment variable      | Default      | Effect                                                   |
| ------------------------- | ------------ | -------------------------------------------------------- |
| `HOST`                    | `127.0.0.1`  | Server bind host and input to runtime address resolution |
| `PORT`                    | `5051`       | Server listen port and runtime webhook URL               |
| `LOCALIX_DEFAULT_USER_ID` | `local-user` | User scope used when `x-user-id` is absent or blank      |

## Limits

- The endpoint trusts network reachability and the self-asserted `x-user-id` header. Web pages
  cannot call it: a request with an `Origin` other than the Localix app's is refused, as is one
  whose `Host` is not a loopback name. Neither check authenticates scripts or local processes.
- Send the body as `application/json`. A request with no `Origin` and a form or plain-text body is
  refused unless it carries `x-localix-client: 1`, because a web page can send exactly that.
- Binding the API to a non-loopback interface exposes the webhook with the rest of the API. Only a
  concrete `HOST` address is accepted as `Host`, so a proxy must forward a loopback `Host`. Put an
  authenticating trusted proxy in front before accepting requests from another machine.
- There is no webhook-specific idempotency key, signature timestamp, replay cache, delivery receipt,
  or callback when the resulting agent turn completes.
- `source` is inserted into model-visible provenance after trimming. Do not treat it as proof of the
  sending process, and do not pass an untrusted value when a fixed caller label is available.
- The 65,536 limit counts UTF-16 code units, not encoded request bytes. Attach or summarize large
  logs and diffs instead of sending them as one prompt.
- A successful queued response confirms admission to the session queue, not completion of the turn.
- This page covers inbound session messages. Outbound lifecycle notifications are a separate plugin
  surface.

## Related guides

- [Organize sessions and projects](sessions-and-projects.md)
- [Choose a delegation mechanism](delegation.md)
- [Create plugins](../extending/plugins.md)
- [Privacy and outbound connections](../getting-started/privacy.md)

## Source of truth

- [Webhook route and validation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/webhook/routes.ts)
- [Model-visible provenance wrapper](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/webhook/wrap.ts)
- [Runtime address resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/runtime-address.ts)
- [Request identity boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/request-identity.ts)
- [Chat turn admission and busy queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/turn-entry.ts)
- [Wake provenance projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/wake-provenance.ts)
- [Runtime context line](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/system-prompt-sections.ts)
