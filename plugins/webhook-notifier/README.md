# Webhook Notifier

Webhook Notifier sends selected Localix session lifecycle events to one HTTP endpoint. Each event is
an asynchronous JSON `POST`; a delivery failure does not interrupt the session turn. Every failure
is logged. Each hook registration also reports the first failure for a session as an inline notice;
a successful delivery clears that session’s warning suppression.

## What it does

Every delivery uses the same envelope:

```json
{
  "event": "subagent_stop",
  "sessionId": "session-id",
  "ts": "2026-08-07T12:34:56.000Z",
  "payload": {
    "childSessionId": "child-session-id",
    "status": "completed",
    "durationMs": 41873,
    "summary": "Work completed"
  }
}
```

The timestamp is generated immediately before delivery. When `SECRET` is set, the plugin computes an
HMAC-SHA256 digest over the exact JSON body and sends its lowercase hexadecimal value in the
`X-Localix-Signature` header.

## Contributions

| Surface            | Contribution          | State and confirmation                                                           |
| ------------------ | --------------------- | -------------------------------------------------------------------------------- |
| Agent tools        | None                  | There are no read-only, mutating, or confirmation-gated agent tools              |
| UI panels or views | None                  | No UI action or confirmation is registered                                       |
| Commands           | None                  | No slash command is registered                                                   |
| Roles              | None                  | No worker role is registered                                                     |
| MCP servers        | None                  | No MCP process or connection is registered                                       |
| Hooks              | Seven lifecycle hooks | Each selected hook starts an outbound `POST` without a per-delivery confirmation |

The manifest's `tools` entry points to the native module, but that module returns hooks only. The
outbound request is a side effect of the hook, not an agent tool call, so agent tool permission
rules do not classify or confirm individual deliveries. Enabling the plugin is the activation and
trust decision.

### Hook payloads

| Hook                 | Event name          | Payload fields                                      |
| -------------------- | ------------------- | --------------------------------------------------- |
| `onSessionEnd`       | `session_end`       | Empty object                                        |
| `onUserMessage`      | `user_message`      | `messageId`, `text`                                 |
| `onAssistantMessage` | `assistant_message` | `messageId`, `content`                              |
| `onPostToolCall`     | `tool_call`         | `toolName`, result `content`                        |
| `onHitlRequest`      | `hitl_request`      | `requestId`, `kind`, `toolName`, `title`            |
| `onHitlResolved`     | `hitl_resolved`     | `requestId`, `kind`, `toolName`, `dismissed`        |
| `onSubagentStop`     | `subagent_stop`     | `childSessionId`, `status`, `durationMs`, `summary` |

## Default state

The bundled manifest declares `defaultEnabled: true`. Agent-owned plugin rules can disable it;
third-party copies still require their own trust decision. No request is sent unless `WEBHOOK_URL`
is configured, even when the hooks are loaded.

## Requirements

| Requirement                                        | Why it is needed                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Enabled plugin                                     | Disabled plugins do not load the lifecycle hooks                        |
| `WEBHOOK_URL`                                      | The plugin returns without delivering when the URL is empty             |
| Reachability from the Localix process              | Delivery uses that process's global `fetch` implementation              |
| Active Localix session runtime                     | Hooks run only when the runtime emits the corresponding lifecycle event |
| Receiver capable of accepting JSON `POST` requests | The method and `Content-Type: application/json` header are fixed        |
| Shared secret at the receiver, optional            | Required only when the receiver verifies `X-Localix-Signature`          |

The plugin does not invoke an external binary, start a service, or establish a persistent
connection. The webhook receiver is separate and must already be available.

## Configuration

Configure these manifest keys for the enabled plugin:

| Key               | Type             | Default | Effect                                                                        |
| ----------------- | ---------------- | ------- | ----------------------------------------------------------------------------- |
| `WEBHOOK_URL`     | String, required | None    | Receives every selected JSON delivery                                         |
| `EVENTS`          | String           | Empty   | Comma-separated event names; empty selects all seven supported events         |
| `SECRET`          | Secret string    | Empty   | Adds the hexadecimal HMAC-SHA256 signature header                             |
| `TIMEOUT_SECONDS` | Number           | `5`     | Sets the request timeout; effective values are clamped to at least one second |

`EVENTS` accepts `session_end`, `user_message`, `assistant_message`, `tool_call`, `hitl_request`,
`hitl_resolved`, and `subagent_stop`. Whitespace around comma-separated entries is removed. Unknown
names are ignored and logged; if no supplied name matches, the plugin logs that nothing will be
delivered.

The receiver must compute its digest from the unmodified raw request body. No signature header is
sent when `SECRET` is empty.

## Limits

- Delivery is fire-and-forget. There is no retry, queue, batch, replay, persistence, or delivery
  acknowledgement.
- Network failures, timeouts and non-2xx responses are logged, and the first of them in a session is
  reported once in the chat. Later failures in the same session stay in the log until a delivery
  succeeds. The suppression set belongs to one registration instance and is keyed by session;
  reloading or re-registering the plugin resets it.
- Selected payloads can send user text, assistant content, tool-result content, and worker summaries
  outside the Localix process. The plugin provides no payload redaction beyond the length cap.
- The destination method and headers are fixed. The plugin provides no custom header, bearer-token,
  proxy, or per-event URL configuration.
- `onSessionStart` is not implemented, so a receiver cannot learn that a session started from this
  plugin.
- `onPreToolCall` is not implemented. Tool-call notifications occur only after a tool call through
  `onPostToolCall`.
- Tool-call payloads omit tool input. Resolved HITL payloads omit the response and report only the
  request identity, kind, tool name, and whether it was dismissed.
- `text`, `content`, and `summary` values longer than 4,000 characters are cut at that boundary and
  receive an `…[truncated]` suffix. Other payload fields are not passed through that helper.
- Filtering is limited to the seven exact, case-sensitive event names listed above.
- HMAC signing authenticates the body only when the receiver independently holds and verifies the
  same secret. It does not encrypt the request body.
- The plugin does not wait for delivery before allowing the lifecycle handler to return. A process
  exit can therefore end an in-flight request.

## Source of truth

- [Manifest and configuration schema](./plugin.json)
- [Hook registration, filtering, payloads, signing, and delivery](./hooks/index.mjs)
- [Behavior and hook-coverage tests](hooks/integration.test.ts)
- [Default-enable policy](../../apps/api/src/features/plugins/enable.ts)
- [Shared trust classification](../../apps/api/src/features/ext/trust.ts)
