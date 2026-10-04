# `@localixai/notifications`

`@localixai/notifications` is a private workspace package and is not intended for external
consumption. The Localix UI consumes it to share notification events, preferences, routing policy,
deduplication, and terminal encoding without sharing presentation code.

## Consumers

The UI supplies Notification Center, toast, and desktop-native transports and persists its own
preferences. The terminal transport encodes the same agent lifecycle facts as an OSC or BEL signal
for a host that runs on a TTY.

## Entry points

| Entry point                | Contract                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/notifications` | Exports surface-neutral event, action, preference, context, and transport types; event factories; preference migration; channel policy; the stateful router; and OSC 9, OSC 777, and BEL terminal adapters. |

Only the package root is exported. Source-file paths are not public subpath entry points.

## Limits

- The package marks durable or ephemeral intent but stores nothing. Hosts provide history,
  preference storage, toast, and native transports.
- Durable events reach an available history transport even when quiet, focused, or past their
  interruption TTL. Interruptive channels are selected only for errors and `hitl.required`.
- Router deduplication is in memory and scoped to one router instance. `reset()` clears it.
- Terminal output requires a TTY. Automatic detection recognizes Warp through `TERM_PROGRAM` and
  `WARP_CLIENT_VERSION`; other terminals require an explicit OSC 9, OSC 777, or BEL method.
- Actions are declarative data. A transport may omit action kinds it cannot render.

## Source of truth

- [Root exports](src/index.ts)
- [Domain contracts](src/contracts.ts)
- [Event factories](src/events.ts)
- [Channel policy](src/policy.ts)
- [Router](src/router.ts)
- [Terminal adapter](src/terminal.ts)
