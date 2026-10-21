/**
 * The wording shown when a send fails — one owner for both send paths.
 *
 * Two call sites raise it: `agentRuntime.sendMessage` (an existing session) and
 * the new-session branch in `useSendMessage`, which calls `backendClient`
 * directly and so never passes through the first. They must say the same thing.
 *
 * Why it must say anything at all: the composer clears on Enter and the optimistic
 * transcript rows are dropped when the send rejects (correctly — the message is not
 * in the transcript, so it must not look like it is). Without a notice the user's
 * line appears and then vanishes with no explanation.
 *
 * It returns two fields rather than one string because it used to glue them: `Message not
 * sent: TypeError: Failed to fetch` put a V8 type name in a headline. The outcome is the
 * sentence, the cause is the body — which is where the centre already renders it.
 */
export function sendFailure(error: unknown): { message: string; detail?: string } {
  const detail = error instanceof Error ? error.message.trim() : ''
  return { message: 'Could not send the message', detail: detail || undefined }
}
