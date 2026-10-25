/**
 * What every surface agrees on about the session recap: when it is due, how many turns it needs
 * and how long it may be. Dependency-free, so a browser bundle and the API read the same numbers.
 */

/** A recap is due once the last finished turn is this old (Claude Code's "three minutes"). */
export const RECAP_AFTER_MS = 3 * 60_000
/** An automatic recap needs a session with at least this many finished turns. */
export const RECAP_MIN_TURNS = 3
/** The most a recap may say. */
export const RECAP_MAX_CHARS = 400
