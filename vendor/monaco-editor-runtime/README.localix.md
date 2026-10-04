# Vendored Monaco Editor runtime

This directory contains the ESM runtime built from an external
`microsoft/monaco-editor` source checkout at commit
`a1f1d02c2084f4cc7e170bf9b5dd063536142991` (upstream version `0.56.0`).

It intentionally contains only the browser runtime, type declarations, the
transitive browser modules referenced by that runtime, and their upstream
license notices. Build tools, development dependencies, AMD output, and
minified output are excluded from the application dependency.

Upstream's `ThirdPartyNotices.txt` covers what Microsoft incorporated into monaco-editor
itself, not monaco-editor's own npm dependencies, which its ESM build inlines under
`esm/external/`. Those carry their own MIT notices, reproduced in
`THIRD_PARTY_NOTICES.localix.txt` — a Localix-maintained file, not an upstream artifact.

The full upstream repository does not live under `vendor/` and is not needed to install or run
Localix. To refresh this package, clone upstream outside this repository at the commit recorded in
`package.json`, install and build inside that checkout using upstream's own lockfiles, then replace
`esm/`, `LICENSE`, and `ThirdPartyNotices.txt` here. Preserve this package manifest and
`THIRD_PARTY_NOTICES.localix.txt`, and update the source commit and version together with the
generated runtime. If the refreshed build inlines a package that file does not name,
`bun run check:vendor` fails until its notice is added.
