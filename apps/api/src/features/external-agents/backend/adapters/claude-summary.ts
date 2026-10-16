import type { SessionSummary } from '../../shared/contracts'
import type { SourceRef } from './types'
import { parseWindowLines, readHead, readTail, streamJsonlRecords } from './fs-read'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, asNumber as numberOf, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

export const ID = 'claude-code'
const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 32 * 1024
const MAX_USAGE_FILE_BYTES = 128 * 1024 * 1024

export async function summarizeClaudeCode(ref: SourceRef): Promise<SessionSummary> {
  const [head, tail] = await Promise.all([
    readHead(ref.sourcePath, HEAD_BYTES),
    readTail(ref.sourcePath, TAIL_BYTES),
  ])
  const headRecords = parseWindowLines(head, 'head')
  const tailRecords = parseWindowLines(tail, 'tail')

  let cwd: string | undefined
  let startedAt: number | undefined
  let firstPrompt: string | undefined
  for (const rec of headRecords) {
    cwd ??= asString(rec.cwd)
    const ts = asString(rec.timestamp)
    if (ts && startedAt === undefined) startedAt = Date.parse(ts) || undefined
    if (!firstPrompt && rec.type === 'user' && rec.isMeta !== true) {
      const message = asRecord(rec.message)
      const text = message ? textOfContent(message.content) : undefined
      // Slash-command echoes and caveat blocks are Claude Code bookkeeping, not the user's intent.
      if (
        text &&
        !text.startsWith('<command-name>') &&
        !text.startsWith('<local-command-caveat>')
      ) {
        firstPrompt = text
      }
    }
  }

  let aiTitle: string | undefined
  let updatedAt = ref.updatedAtHint ?? 0
  for (const rec of tailRecords) {
    const t = asString(rec.aiTitle)
    if (t) aiTitle = t
    const ts = asString(rec.timestamp)
    if (ts) {
      const parsed = Date.parse(ts)
      if (parsed && parsed > updatedAt) updatedAt = parsed
    }
  }

  const title = aiTitle ?? firstText(firstPrompt, 120) ?? ref.nativeSessionId
  const usageByMessage = new Map<
    string,
    { usage: ReturnType<typeof normalizeTokenSample>; model?: string; timestamp?: number }
  >()
  const messageIds = new Set<string>()
  let anonymousId = 0
  if ((ref.sourceBytes ?? 0) <= MAX_USAGE_FILE_BYTES) {
    for await (const rec of streamJsonlRecords(
      ref.sourcePath,
      Math.min(MAX_USAGE_FILE_BYTES + 1, (ref.sourceBytes ?? MAX_USAGE_FILE_BYTES) + 1),
    )) {
      const type = asString(rec.type)
      if ((type !== 'user' && type !== 'assistant') || rec.isMeta === true) continue
      const message = asRecord(rec.message)
      if (!message) continue
      const identity =
        asString(message.id) ?? asString(rec.uuid) ?? `${type}:anonymous-${anonymousId++}`
      messageIds.add(identity)
      if (type !== 'assistant') continue
      const raw = asRecord(message.usage)
      if (!raw) continue
      const timestampText = asString(rec.timestamp)
      usageByMessage.set(identity, {
        usage: normalizeTokenSample({
          inputTokens: numberOf(raw.input_tokens),
          cachedInputTokens: numberOf(raw.cache_read_input_tokens),
          cacheWriteTokens: numberOf(raw.cache_creation_input_tokens),
          outputTokens: numberOf(raw.output_tokens),
        }),
        model: asString(message.model),
        timestamp: timestampText ? Date.parse(timestampText) || undefined : undefined,
      })
    }
  }
  const usage = new SessionUsageAccumulator()
  for (const sample of usageByMessage.values()) {
    usage.add(sample.usage, sample.model, sample.timestamp)
  }
  const measured = usage.result()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId: ref.nativeSessionId }),
    provider: ID,
    nativeSessionId: ref.nativeSessionId,
    title,
    cwd: cwd ?? ref.cwdHint,
    startedAt,
    updatedAt: updatedAt || Date.now(),
    ...(messageIds.size > 0 ? { messageCount: messageIds.size } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: ref.sourcePath,
    parentNativeSessionId: ref.parentHint,
  }
}
