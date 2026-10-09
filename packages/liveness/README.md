# `@localixai/liveness`

This private workspace package shares endpoint watchers between subscribers and publishes changes in
availability. The API uses it to track preview servers through probes and owner reports.

## Entry points

| Entry point                 | Exports                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `@localixai/liveness`       | `createLivenessRegistry`, target/state/policy types, default policy, and probe helpers. |
| `@localixai/liveness/probe` | `probeTcp`, `probeUnixSocket`, `probeFor`, and `tcpEndpointOf`.                         |

Only these two manifest entry points are exported.

## Watcher ownership

A registry shares one watcher per caller-supplied key. Use a stable key for the same target; keys
are not automatically derived from endpoint addresses. The first subscriber starts probing, and the
last unsubscribe cancels the watcher and drops its state.

| Operation                      | Behavior                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `watch(key, target, listener)` | Subscribe and receive known state immediately, then availability changes; returns an unsubscribe function. |
| `peek(key)`                    | Read a state snapshot without starting a watcher; absent keys return `undefined`.                          |
| `refresh(key)`                 | Probe a watched target now; a missing key rejects, and an existing in-flight probe is not duplicated.      |
| `report(key, true)`            | Publish the owner's positive report immediately.                                                           |
| `report(key, false)`           | Publish immediately for an unprobed target; for a probeable target, verify before declaring it down.       |

A failed verification after a negative report bypasses the normal failure threshold. A report for an
unwatched key is ignored. A `reported` target has no probe and remains unknown until its owner
reports an answer.

## Probe policy

| Setting            | Default | Effect                                                                   |
| ------------------ | ------- | ------------------------------------------------------------------------ |
| `timeoutMs`        | 300     | Timeout for the built-in TCP, Unix-socket, and HTTP probes.              |
| `periodMs`         | 2,000   | Minimum delay between scheduled probes.                                  |
| `maxPeriodMs`      | 30,000  | Maximum adaptive delay.                                                  |
| `costFactor`       | 20      | Multiplies measured average probe duration when choosing the next delay. |
| `failureThreshold` | 2       | Consecutive failures needed to change a known live state to down.        |
| `successThreshold` | 1       | Consecutive successes needed to change a known down state to live.       |

The next delay is `min(max(average probe duration × costFactor, periodMs), maxPeriodMs)`. The first
answer publishes without waiting for a threshold. Policy overrides belong to the registry; a custom
probe owns its own timeout and cancellation behavior.

## Limits

- A TCP connection proves that a listener accepts connections. It does not prove application health.
- A `url` target with `expectResponse` sends HTTP `HEAD` and accepts any response status, including
  404 or 502. Supply a `custom` probe when health depends on status or response content.
- `tcpEndpointOf` supplies default ports for HTTP, HTTPS, WS, and WSS; malformed URLs or invalid
  ports return `null`.
- Unix-socket targets are POSIX-only; Windows named pipes are not covered.
- Adaptive delay limits probe frequency. It is not a CPU quota or a guarantee about total process
  cost.

## Source of truth

- [Root exports](src/index.ts)
- [Targets and default policy](src/types.ts)
- [Registry ownership and report verification](src/registry.ts)
- [Probe selection and URL parsing](src/probe/index.ts)
- [TCP and Unix-socket probes](src/probe/tcp.ts)
- [API preview consumer](../../apps/api/src/features/liveness/preview-liveness.ts)
