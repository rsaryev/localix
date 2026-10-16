/**
 * Inbound-webhook message framing.
 *
 * An external system (another agent, CI, a monitor) pushes a plain message into a
 * session via `POST /rpc/webhook/messages`. We prepend ONE compact, model-visible
 * provenance line so the agent knows the message came from an external system (and
 * which one), and was NOT typed by the user — the structural `origin: 'external'`
 * tag on the persisted row is for downstream/UI; this line is for the model itself.
 *
 * Pure + no deps so it's trivially unit-tested and shared.
 */
export function wrapInboundMessage(prompt: string, source?: string): string {
  const who = source?.trim() ? ` "${source.trim()}"` : ''
  return `[Inbound message from an external system${who} — delivered via webhook, not typed by the user]\n\n${prompt}`
}
