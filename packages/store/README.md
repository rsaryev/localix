# `@localixai/store`

This package is internal to the Localix workspace. It owns the Store's contract: listings, install
plans, jobs, sources, the shelves derived from listings, the `/rpc/store` bodies and the
`StoreProvider` port each package kind implements.

## Consumers

The API's Store feature (`apps/api/src/features/store`), the providers (`features/mini-apps` today)
and the UI's Store slice. It names no provider and parses no package format, so mini apps and
plugins can both serve the Store without knowing each other (rule X1,
`docs/internals/plugins-and-mini-apps.md`).

## Entry points

| Entry point                | Contract                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `@localixai/store`         | Zod schemas and types, the provider port, shelf derivation.   |
| `@localixai/store/testing` | `makeListing` and `makeListingDetail` builders for any tests. |

## Limits

Types, schemas and pure functions only. The index, search and routes live in the API's Store
feature; the design is [docs/internals/store.md](../../docs/internals/store.md).
