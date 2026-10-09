import type { QuotaReading, SessionSummary } from '../../shared/contracts'
import type { SourceRef } from './types'
import { parseWindowLines, readHead, streamJsonlRecords } from './fs-read'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, asNumber as numberOf, firstText } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator, usageDelta } from './usage'

export const ID = 'codex'
/**
 * 256 KB, not 64 KB. Codex's first line is the `session_meta` record, whose `base_instructions`
 * blob alone is ~16 KB, and on a real 6 MB rollout the first `user_message` sat at byte 87005.
 * A 64 KB head produced a title-less row; this budget was chosen from that measurement.
 */
const HEAD_BYTES = 256 * 1024
const MAX_USAGE_FILE_BYTES = 128 * 1024 * 1024

/**
 * One `rate_limits` slot as a reading, or nothing. Every field is required: a window without a reset
 * cannot be told from an expired one, and a percentage without a window is a number about nothing.
 */
function quotaOf(
  slot: Record<string, unknown> | undefined,
  planType: string | undefined,
  observedAt: number,
): QuotaReading | undefined {
  if (!slot) return undefined
  const usedPercent = numberOf(slot.used_percent)
  const windowMinutes = numberOf(slot.window_minutes)
  const resetsAtSeconds = numberOf(slot.resets_at)
  if (usedPercent === undefined || !windowMinutes || !resetsAtSeconds) return undefined
  return {
    usedPercent,
    windowMinutes,
    // Codex writes unix SECONDS here; every timestamp we hold is ms.
    resetsAt: resetsAtSeconds * 1000,
    ...(planType ? { planType } : {}),
    observedAt,
  }
}

export async function summarizeCodex(ref: SourceRef): Promise<SessionSummary> {
  const head = await readHead(ref.sourcePath, HEAD_BYTES)
  const records = parseWindowLines(head, 'head')
  let cwd: string | undefined
  let startedAt: number | undefined
  let firstPrompt: string | undefined
  let parentNativeSessionId: string | undefined
  for (const rec of records) {
    const payload = asRecord(rec.payload)
    if (rec.type === 'session_meta' && payload) {
      cwd ??= asString(payload.cwd)
      const ts = asString(payload.timestamp)
      if (ts) startedAt ??= Date.parse(ts) || undefined
      const source = asRecord(payload.source)
      const subagent = asRecord(source?.subagent)
      const spawn = asRecord(subagent?.thread_spawn)
      parentNativeSessionId ??= asString(spawn?.parent_thread_id)
    }
    if (!firstPrompt && rec.type === 'event_msg' && payload?.type === 'user_message') {
      const message = asString(payload.message)
      // Codex injects an `<environment_context>` preamble as a user turn; it is not the request.
      if (message && !message.startsWith('<environment_context>')) firstPrompt = message
    }
  }
  const title =
    firstText(firstPrompt, 120) ??
    (cwd ? `Codex in ${cwd.slice(cwd.lastIndexOf('/') + 1)}` : ref.nativeSessionId)
  const usage = new SessionUsageAccumulator()
  const quotas = new Map<number, QuotaReading>()
  let previousTotal: ReturnType<typeof normalizeTokenSample> | undefined
  let currentModel: string | undefined
  let messageCount = 0
  if ((ref.sourceBytes ?? 0) <= MAX_USAGE_FILE_BYTES) {
    for await (const rec of streamJsonlRecords(
      ref.sourcePath,
      Math.min(MAX_USAGE_FILE_BYTES + 1, (ref.sourceBytes ?? MAX_USAGE_FILE_BYTES) + 1),
    )) {
      const payload = asRecord(rec.payload)
      if (!payload) continue
      if (rec.type === 'turn_context') {
        currentModel = asString(payload.model) ?? currentModel
        continue
      }
      if (rec.type === 'response_item' && payload.type === 'message') {
        const role = asString(payload.role)
        if (role === 'user' || role === 'assistant') messageCount += 1
        continue
      }
      if (rec.type !== 'event_msg' || payload.type !== 'token_count') continue
      // The account's quota windows ride on the SAME event as the token counters, so reading them
      // costs nothing this walk was not already paying. Both slots are read and keyed on the
      // window's LENGTH, because `primary` does not name a fixed window: with two open, `primary` is
      // the 5-hour one and the weekly moves to `secondary`. Last reading of each window wins.
      const limits = asRecord(payload.rate_limits)
      if (limits) {
        const planType = asString(limits.plan_type)
        const at = Date.parse(asString(rec.timestamp) ?? '') || Date.now()
        for (const slot of [limits.primary, limits.secondary]) {
          const reading = quotaOf(asRecord(slot), planType, at)
          if (reading) quotas.set(reading.windowMinutes, reading)
        }
      }
      const info = asRecord(payload.info)
      const total = asRecord(info?.total_token_usage)
      const last = asRecord(info?.last_token_usage)
      const timestampText = asString(rec.timestamp)
      const timestamp = timestampText ? Date.parse(timestampText) || undefined : undefined
      currentModel = asString(info?.model) ?? currentModel
      if (total) {
        const normalized = normalizeTokenSample({
          inputTokens: numberOf(total.input_tokens),
          cachedInputTokens: numberOf(total.cached_input_tokens ?? total.cache_read_input_tokens),
          cacheWriteTokens: numberOf(total.cache_write_input_tokens),
          outputTokens: numberOf(total.output_tokens),
          reasoningTokens: numberOf(total.reasoning_output_tokens),
          totalTokens: numberOf(total.total_tokens),
          inputIncludesCached: true,
        })
        usage.add(usageDelta(normalized, previousTotal), currentModel, timestamp)
        previousTotal = normalized
      } else if (last) {
        usage.add(
          normalizeTokenSample({
            inputTokens: numberOf(last.input_tokens),
            cachedInputTokens: numberOf(last.cached_input_tokens ?? last.cache_read_input_tokens),
            cacheWriteTokens: numberOf(last.cache_write_input_tokens),
            outputTokens: numberOf(last.output_tokens),
            reasoningTokens: numberOf(last.reasoning_output_tokens),
            totalTokens: numberOf(last.total_tokens),
            inputIncludesCached: true,
          }),
          currentModel,
          timestamp,
        )
      }
    }
  }

  const measured = usage.result()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId: ref.nativeSessionId }),
    provider: ID,
    nativeSessionId: ref.nativeSessionId,
    title,
    cwd,
    startedAt,
    updatedAt: ref.updatedAtHint ?? Date.now(),
    ...(messageCount > 0 ? { messageCount } : {}),
    ...(measured ? { usage: measured } : {}),
    ...(quotas.size > 0 ? { quotas: [...quotas.values()] } : {}),
    sourcePath: ref.sourcePath,
    ...(parentNativeSessionId ? { parentNativeSessionId } : {}),
  }
}
