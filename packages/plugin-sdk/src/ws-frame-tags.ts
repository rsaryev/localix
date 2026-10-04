/**
 * Frame tags core sends itself on the realtime socket: session `s`, rpc `r`, notification
 * journal `n`.
 *
 * A contribution using one would have its frames demuxed by core's handler — a plugin tagging its
 * log stream `n` would be parsed as Event Center changes. Both halves refuse them: the backend
 * registry at registration (`backend/ws-frame-registry.ts`) and the browser runtime before it
 * subscribes (`ui/runtime.ts`). They read this one set; two copies had already drifted, the
 * browser's missing `n`. A leaf with no imports, so the browser bundle can take it.
 */
export const RESERVED_FRAME_TAGS: ReadonlySet<string> = new Set(['s', 'r', 'n'])
