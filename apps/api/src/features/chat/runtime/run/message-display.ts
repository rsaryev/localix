import { isTextItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../db/payload'
import type { CcHooksRuntime } from '../../../cc-hooks'

/**
 * Claude Code `MessageDisplay`, once the turn's text is settled: each text block of the reply is
 * one assistant message to the hook, sent whole as Claude Code's SDK mode sends it. A hook's
 * `displayContent` is kept beside the text (`displayTexts`) and shown in its place; the text the
 * model reads back, the reply handed to a conversation, copy and export keep the original.
 */
export async function withDisplayTexts<P extends StoredMessagePayload>(
  hooks: CcHooksRuntime,
  payload: P,
  turnId: string,
): Promise<P> {
  if (!hooks.hasHooks('MessageDisplay')) return payload
  const displayTexts: Record<string, string> = {}
  for (const item of payload.items ?? []) {
    if (!isTextItem(item) || !item.text.trim()) continue
    const shown = await hooks.runMessageDisplay({ turnId, messageId: item.id, text: item.text })
    if (shown.displayContent !== undefined) displayTexts[item.id] = shown.displayContent
  }
  return Object.keys(displayTexts).length > 0 ? { ...payload, displayTexts } : payload
}

/**
 * {@link withDisplayTexts} on the turn's settled reply. The turn is named by the prompt that
 * started it, or by the reply itself when no prompt row exists.
 */
export async function applyDisplayTexts(
  hooks: CcHooksRuntime,
  ctx: { state: { currentPayload: StoredMessagePayload }; assistantMessageId: string },
  promptMessageId: string | undefined,
): Promise<void> {
  const turnId = promptMessageId ?? ctx.assistantMessageId
  ctx.state.currentPayload = await withDisplayTexts(hooks, ctx.state.currentPayload, turnId)
}
