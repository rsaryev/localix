# `@localixai/notifications`

`@localixai/notifications` is a private workspace package and is not intended for external
consumption. The Localix UI consumes it to share notification events, preferences, routing policy,
deduplication, and terminal encoding without sharing presentation code.

## Consumers

The UI records facts in the server notification journal, keeps a projection in each window, and
persists notification preferences. Desktop-native banners provide interruption; the current web
composition has no toast transport. Terminal hosts can encode the same facts as OSC or BEL signals.

## Entry points

| Entry point                | Contract                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/notifications` | Exports surface-neutral event, action, preference, context, and transport types; event factories; preference migration; channel policy; the stateful router; and OSC 9, OSC 777, and BEL terminal adapters. |

Only the package root is exported. Source-file paths are not public subpath entry points.

## Limits

- The package marks durable or ephemeral intent but stores nothing. Hosts provide history,
  preference storage, and any supported interruption transports.
- Durable events reach an available history transport even when quiet, focused, or past their
  interruption TTL. Interruptive channels are selected for severity `error` or category
  `human-input`, covering questions, mentions, and plans waiting on the person.
- Router deduplication is in memory and scoped to one router instance. `reset()` clears it.
- Terminal output requires a TTY. Automatic detection recognizes Warp through `TERM_PROGRAM` and
  `WARP_CLIENT_VERSION`; other terminals require an explicit OSC 9, OSC 777, or BEL method.
- Actions are declarative data. A transport may omit action kinds it cannot render.

## Related guides

- [User notification controls](../../docs/features/notifications.md)
- [Journal and delivery contracts](../../docs/internals/subsystems/notifications.md)

## Source of truth

- [Root exports](src/index.ts)
- [Domain contracts](src/contracts.ts)
- [Event factories](src/events.ts)
- [Channel policy](src/policy.ts)
- [Router](src/router.ts)
- [Terminal adapter](src/terminal.ts)
