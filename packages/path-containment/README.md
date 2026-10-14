# `@localixai/path-containment`

This package is internal to the Localix workspace and is not intended for outside consumption. It
owns the workspace's lexical path-containment checks and the branded path returned after a
successful check.

## Consumers

The API uses the package for filesystem guards and re-exports it for existing API call sites. The UI
uses its dependency-free ancestry predicates for server-path trees and path display. The API and
extensions use it to keep authored file references and output paths under their configured roots.

## Entry points

| Entry point                            | Contract                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/path-containment`          | Resolves paths with `node:path`; exposes root-inclusive and strictly-below checks, plus `resolveWithin`, which returns an absolute branded `ContainedPath` or `null` on escape. |
| `@localixai/path-containment/ancestry` | Exposes zero-dependency string predicates for already absolute, normalized paths. Callers provide the separator when it is not `/`.                                             |

## Limits

- Checks are lexical. They do not call `realpath`, follow symlinks, inspect the filesystem, or
  provide an operating-system sandbox.
- Empty roots, candidates, targets, and separators fail closed. `resolveWithin` is root-inclusive;
  use `isPathBelow` or `isStrictlyUnder` when the root itself must be rejected.
- `ContainedPath` is compile-time evidence carried by a string, not a runtime wrapper. Callers that
  need symlink-safe decisions must resolve filesystem identities before checking containment.
- The ancestry entry point does not normalize input. Its caller owns absolute-path normalization and
  separator selection.

## Source of truth

- [Node-backed containment and the `ContainedPath` type](src/index.ts)
- [Dependency-free ancestry predicates](src/ancestry.ts)
- [Compile-time brand contract](src/brand.test.ts)
- [Repository-wide ownership guard](src/monopoly.test.ts)
- [API re-export](../../apps/api/src/lib/path-containment.ts)
