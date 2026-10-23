/**
 * Host-shim: the canonical "when is a child process actually gone?" machinery now lives in
 * `@localixai/mini-app-sdk/backend` (dependency-free reusable machinery a bundled mini app backend
 * compiles against, so it can't be a mini app→apps/api deep-import). This file stays as the
 * stable in-host import path (`lib/child-exit`) every host caller already uses.
 */
export { EXIT_DRAIN_MS, awaitChildGone, releaseChildPipes } from '@localixai/mini-app-sdk/backend'
