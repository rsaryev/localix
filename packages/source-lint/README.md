# `@localixai/source-lint`

This workspace-private package provides source-scanning helpers for repository tests that enforce
structural contracts. It is internal to Localix, test-only, and not intended for external
consumption.

## Consumers

The package is imported by the repo-wide path-containment contract in `packages/path-containment`,
source-shape tests in extensions, and the API test that checks parity with its app-local source
scanner.

## Entry points

| Import                                     | Contract                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@localixai/source-lint`](./src/index.ts) | Comment-aware reads with preserved offsets; recursive non-test source discovery; witnessed scans that reject empty coverage; pattern and named-body locators; an injectable detector seam; and on-disk positive-control audits. |

## Limits

- The scanner recognizes JavaScript and TypeScript source extensions. It skips filenames matching
  `*.test.<source-extension>`, dependencies, build output, version-control data, and Turbo caches. A
  `*.spec.ts` file is not excluded by that filename rule.
- Comment removal is a purpose-built lexical scan, not a JavaScript parser. It preserves strings,
  template literals, regular-expression literals, and character offsets for source-shape tests.
- `walkSources()` returns an empty list for an absent root. Contract tests should use `sourceTree()`
  with `mustInclude` witnesses or a `minFiles` floor when an empty scan would pass.
- Reads and tree walks use synchronous filesystem APIs. `auditDetector()` also creates temporary
  fixtures, so this package does not belong in application runtime paths.

## Source of truth

- [`package.json`](./package.json) defines the package boundary and single export.
- [`src/index.ts`](./src/index.ts) defines the supported helper surface.
