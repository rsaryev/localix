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
| Deliver while a run is active   | The chat service queues the webhook as an external wake.                  | The success response has an empty `messageId` until the queued turn runs. |
| Distinguish external input      | The service persists a hidden user row with wake source `external`.       | The UI shows the provenance on the assistant reply, not as a user bubble. |
| Give the model explicit context | The route prefixes the prompt with an external-message provenance line.   | The supplied prompt and source remain model-visible instructions.         |
| Discover the current address    | Runtime context includes the resolved webhook URL and current session id. | The address is for this running backend instance.                         |

## How it works

The route validates the JSON body, wraps the text with one provenance line, and calls the same chat
service entry used by the frontend, including its ownership checks, reference expansion and
busy-session queue. The provenance line precedes the supplied text, so a prompt such as `/usage` is
model-visible text, not a direct slash-command invocation. Webhook input can still instruct an agent
to act; it is not a separate command-dispatch API.

An idle target starts a turn immediately. A busy target enqueues the text with source `external`;
the default queue places it in the machine-wake band alongside loop wakes, behind queued user turns
and participant handoffs. Both paths keep the triggering user row out of the visible transcript and
associate the next visible assistant reply with **External** provenance.

The backend derives the URL from `HOST`, `PORT`, and the canonical webhook path. Wildcard bind
addresses are converted to `127.0.0.1` in the address handed to same-machine callers.

| Outcome                      | HTTP status | Response behavior                                              |
| ---------------------------- | ----------- | -------------------------------------------------------------- |
| Accepted on an idle target   | `200`       | `queued` is `false`; `messageId` identifies the started turn   |
| Accepted on a busy target    | `200`       | `queued` is `true`; `messageId` is an empty string             |
| Invalid JSON fields          | `400`       | The validator rejects the request before chat delivery         |
| Host/origin policy rejection | `403`       | The API boundary refuses the request before delivery           |
| Chat service rejection       | `409`       | `error.code` is `webhook_send_failed` with the service message |

## Configuration

### Request

| Field       | Required | Constraint                    | Meaning                                                                      |
| ----------- | -------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `sessionId` | Yes      | Non-empty string              | Existing chat session to receive the turn                                    |
| `prompt`    | Yes      | 1–65,536 UTF-16 code units    | Model-visible external message                                               |
| `source`    | No       | At most 120 UTF-16 code units | Unverified caller label shown as provenance                                  |
| `x-user-id` | No       | Trimmed when present          | Self-asserted user scope; omission or blank uses the configured default user |

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

- The endpoint trusts network reachability and the self-asserted `x-user-id` header. Allowed Host
  names include loopback names and the configured concrete bind host. Allowed page origins include
  the packaged app, explicitly configured `LOCALIX_UI_ORIGINS`, and the API's same-origin page when
  it serves the UI. Other page origins are refused before delivery. These checks do not authenticate
  scripts or local processes.
- Send the body as `application/json`. A request with no `Origin` and a form or plain-text body is
  refused at the API boundary unless it carries a non-empty `x-localix-client` header. The webhook
  still requires valid JSON fields after that boundary check; the header does not make a plain-text
  body a valid request.
- Binding the API to a non-loopback interface exposes the webhook with the rest of the API. Wildcard
  bind addresses do not authorize arbitrary Host names. A proxy must forward an accepted Host. Put
  an authenticating trusted proxy in front before accepting requests from another machine.
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
- [Forks](delegation.md)
- [Create plugins](../extending/plugins.md)
- [Privacy and outbound connections](../getting-started/privacy.md)

## Source of truth

- [Webhook route and validation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/webhook/routes.ts)
- [Model-visible provenance wrapper](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/webhook/wrap.ts)
- [Runtime address resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/runtime-address.ts)
- [Request identity boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/request-identity.ts)
- [Host and page-origin policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/lib/local-origin-guard.ts)
- [Slash-command recognition](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/slash-commands.ts)
- [Queue priority policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/queue-policy.ts)
- [Chat turn admission and busy queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/turn-entry.ts)
- [Wake provenance projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/wake-provenance.ts)
- [Runtime context line](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/system-prompt-sections.ts)
