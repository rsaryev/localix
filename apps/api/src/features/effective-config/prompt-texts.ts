import { createPromptTextStore } from '@localixai/agent'

/**
 * The one prompt-text store this process keeps.
 *
 * A module-level singleton for the same reason the composition snapshot is one: the question
 * it answers is about the process's own recent behaviour, and a per-request store would have
 * nothing in it. Content-addressed, so one instance shared across sessions is not a leak
 * between them — a hash is only guessable by someone who already has the text.
 *
 * Reachable only under LOCALIX_CACHE_DIAGNOSTICS, because that is the only path that fills it
 * (see chat/runtime/message-persistence.ts).
 */
export const promptTexts = createPromptTextStore()
