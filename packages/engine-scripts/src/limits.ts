/**
 * What one script may cost the HOST. The VM's own heap is capped separately; these bound what
 * crosses out of it, which the VM limit does not cover once it is a host string.
 *
 * The prelude enforces the output limits too, so a script learns of them where it prints. The host
 * enforces every one of them again on what it receives: it never trusts a length the VM computed.
 */

/**
 * Output the host holds until the script ends: characters (base64 image data and the return value
 * included) and items. The item limit catches a loop printing empty strings.
 */
export const MAX_OUTPUT_CHARS = 4 * 1024 * 1024
export const MAX_OUTPUT_ITEMS = 50_000

/** Calls running at once; the rest wait their turn. Each may spawn a process or raise a card. */
export const MAX_CONCURRENT_CALLS = 8
/** Calls one script may make in all. Past it the script fails. */
export const MAX_CALLS = 1_000
/** One call's arguments, as JSON characters: a `write` of a large file fits. */
export const MAX_CALL_ARGS_CHARS = 4 * 1024 * 1024
/** Every call's arguments together, held while they wait or run. */
export const MAX_TOTAL_CALL_ARGS_CHARS = 64 * 1024 * 1024
