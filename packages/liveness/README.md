# `@localixai/liveness`

This package is internal to the Localix workspace and is not intended for outside consumption. It
answers one question — is this endpoint accepting connections right now — for many subscribers at
once, and publishes the answer only when it changes.

No operating system offers a portable event for a port closing, so this package polls and emits
changes, and keeps the quality in what surrounds the poll: one refcounted watcher per endpoint, a
period that adapts to the measured cost of the check, thresholds that absorb a single lost probe,
and an authoritative `report` path for an owner that already knows.

## Consumers

The API watches preview servers with it: a dev server the agent spawned reports its own death from
the process exit, while a server started outside Localix is checked with a TCP connect. Any feature
that tracks an endpoint — a plugin's service, an external agent, a container — uses the same
registry rather than adding a second polling loop.

## Entry points

| Entry point                 | Contract                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/liveness`       | `createLivenessRegistry` (watch, peek, refresh, report), the target and policy types, and the default policy.                   |
| `@localixai/liveness/probe` | The checks themselves: `probeTcp`, `probeUnixSocket`, `probeFor`, and `tcpEndpointOf` for reading a host and port out of a URL. |

## Policy

Defaults follow Kubernetes probe vocabulary: `timeoutMs` 300 (wait-on's TCP default), `periodMs`
2000, `maxPeriodMs` 30000, `failureThreshold` 2, `successThreshold` 1. The period is
`max(average probe cost × costFactor, periodMs)`, capped — with the default factor of 20 the watcher
keeps its share of the machine near five percent however slow the check turns out to be.

## Limits

- A TCP connect proves that something accepts connections on that port, not that the application
  behind it is healthy. Use a `url` target with `expectResponse` where a proxy can outlive its app.
- Unix-socket targets are POSIX-only; Windows named pipes are not covered.
- State is dropped when the last subscriber leaves. A fact nobody is watching is a fact nobody has
  checked, and a stale "alive" is worse than an honest "unknown".
- A `reported` target is never probed. Its owner is the only source, and silence from that owner
  reads as unknown, not as down.
