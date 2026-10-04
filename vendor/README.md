# Vendored dependencies

The contents of this directory have a different maintenance lifecycle from Localix application
code. Root formatting, lint, and dead-code scans exclude the entire tree so periodic upstream syncs
do not acquire unrelated Localix style changes. Root type-check, build, and test tasks still exercise
vendored packages that are Bun workspaces.

## Pi

`pi/` is a committed source snapshot, not a nested Git checkout. Update it from a reviewed upstream
commit using the procedure and Localix delta recorded in [`pi/UPSTREAM.md`](./pi/UPSTREAM.md). Keep
upstream formatting intact; do not run the root formatter over the copied files.

## Monaco Editor

`monaco-editor-runtime/` is the committed, generated browser runtime consumed by the UI. Its source
commit and refresh procedure are recorded in
[`monaco-editor-runtime/README.localix.md`](./monaco-editor-runtime/README.localix.md).

`monaco-editor/` is an ignored, disposable upstream Git checkout used only by maintainers to fetch,
sync, install, and build Monaco. It is not needed by a fresh Localix clone and must never be committed
to this repository.
