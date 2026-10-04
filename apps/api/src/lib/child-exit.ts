/**
 * Host-shim: the canonical "when is a child process actually gone?" machinery now lives in
 * `@localixai/plugin-sdk/backend` (dependency-free reusable machinery a bundled plugin backend
 * compiles against, so it can't be a plugin→apps/api deep-import). This file stays as the
 * stable in-host import path (`lib/child-exit`) every host caller already uses.
 */
export {
  EXIT_DRAIN_MS,
  KILL_ESCALATION_MS,
  awaitBunChildGone,
  awaitChildGone,
  releaseChildPipes,
} from '@localixai/plugin-sdk/backend'
export type { BunChild, ChildGone } from '@localixai/plugin-sdk/backend'
