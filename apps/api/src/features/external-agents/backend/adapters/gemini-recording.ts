import type { SourceRef, TranscriptRequest, TranscriptResult } from './types'
import type { SessionSummary } from '../../shared/contracts'
import { clip } from './fs-read'
import { eventWindow } from './event-window'
import { TURN_EVIDENCE_MS, type TurnState } from '../live/turn-state'
import { linkKeyOf } from '../../shared/identity'
import { asNumber, asRecord, asString, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

export const ID = 'gemini-cli'

export interface GeminiDoc {
  sessionId?: unknown
  startTime?: unknown
  lastUpdated?: unknown
  messages?: unknown
}

/** Normalize a recording after the adapter has loaded it. */
export function summarizeGeminiDoc(doc: GeminiDoc | undefined, ref: SourceRef): SessionSummary {
  // IDENTITY COMES FROM THE REF, never from the document.
  //
  // `listSources` must be cheap, so the id it can produce is the one derived from the file name —
  // and that is the id every key, link and lookup is built on. Overriding it here with the
  // document's own `sessionId` produced a roster whose keys named something `listSources` had never
  // heard of, so `findSource` matched nothing and EVERY Gemini session opened empty. The two ids
  // are both stable; only one of them can be the identity, and it has to be the cheap one.
  const nativeSessionId = ref.nativeSessionId
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  let firstPrompt: string | undefined
  for (const raw of messages) {
    const rec = asRecord(raw)
    if (rec?.type !== 'user') continue
    // `content` is a bare string on assistant turns but a `{text}[]` block array on user turns —
    // verified on real recordings. Reading only the string form silently yields empty transcripts.
    const content = textOfContent(rec.content)
    if (content) {
      firstPrompt = content
      break
    }
  }
  const started = asString(doc?.startTime)
  const updated = asString(doc?.lastUpdated)
  const usage = new SessionUsageAccumulator()
  let messageCount = 0
  for (const raw of messages) {
    const message = asRecord(raw)
    const type = asString(message?.type)
    if (type !== 'user' && type !== 'gemini') continue
    messageCount += 1
    if (type !== 'gemini') continue
    const tokens = asRecord(message?.tokens)
    if (!tokens) continue
    const timestampText = asString(message?.timestamp)
    usage.add(
      normalizeTokenSample({
        inputTokens: asNumber(tokens.input),
        cachedInputTokens: asNumber(tokens.cached),
        outputTokens: asNumber(tokens.output),
        reasoningTokens: asNumber(tokens.thoughts),
        totalTokens: asNumber(tokens.total),
        inputIncludesCached: true,
        reasoningIncludedInOutput: false,
      }),
      asString(message?.model),
      timestampText ? Date.parse(timestampText) || undefined : asNumber(message?.timestamp),
    )
  }
  const measured = usage.result()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId }),
    provider: ID,
    nativeSessionId,
    title: firstText(firstPrompt, 120) ?? ref.nativeSessionId,
    // The recording carries no cwd; `cwdHint` is what `~/.gemini/projects.json` resolved the chat's
    // own directory name to, and is absent when it resolved to nothing. Reporting the directory
    // name itself would be a label standing where a path belongs.
    ...(ref.cwdHint ? { cwd: ref.cwdHint } : {}),
    startedAt: started ? Date.parse(started) || undefined : undefined,
    updatedAt: (updated ? Date.parse(updated) : 0) || ref.updatedAtHint || Date.now(),
    ...(messageCount > 0 ? { messageCount } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: ref.sourcePath,
  }
}

/**
 * The readable output of a recorded tool call.
 *
 * Gemini keeps a call's result as the raw `functionResponse` envelope the model was handed back, so
 * the payload sits two levels in. An envelope we do not recognise is serialized rather than
 * dropped: an unfamiliar result is still evidence of what the agent did, and silently showing a
 * call with no OUT would read as a call that returned nothing.
 */
function toolOutputOf(result: unknown): string | undefined {
  if (!Array.isArray(result)) return undefined
  const parts: string[] = []
  for (const entry of result) {
    const response = asRecord(asRecord(entry)?.functionResponse)?.response
    if (response === undefined) continue
    const output = asRecord(response)?.output
    parts.push(typeof output === 'string' ? output : JSON.stringify(response))
  }
  const text = parts.join('\n').trim()
  return text || undefined
}

export function transcriptFromGeminiDoc(
  doc: GeminiDoc | undefined,
  req: TranscriptRequest,
): TranscriptResult {
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  const nativeSessionId = req.ref.nativeSessionId
  const window = eventWindow(req.maxEvents, req.tail, req.from)
  for (const raw of messages) {
    const rec = asRecord(raw)
    if (!rec) continue
    const type = asString(rec.type)
    const role = type === 'user' ? 'user' : type === 'gemini' ? 'assistant' : undefined
    if (!role) continue
    const ts = asString(rec.timestamp)
    const base = {
      provider: ID,
      nativeSessionId,
      timestamp: ts ? Date.parse(ts) || undefined : asNumber(rec.timestamp),
    }
    const text = textOfContent(rec.content)
    if (text) window.emit({ ...base, role, text: clip(text, req.maxCharsPerEvent) })
    /**
     * TOOL CALLS LIVE BESIDE THE TEXT, not inside it.
     *
     * A turn that only called tools records `content: ""` and puts everything in `toolCalls`, so
     * skipping empty-text messages — which this loop used to do before reading any further —
     * dropped the tool half of the session outright. Measured on a real recording: 148 of 193
     * messages carry `toolCalls`, and the transcript this adapter produced for them contained
     * nothing but user and assistant prose.
     */
    for (const entry of Array.isArray(rec.toolCalls) ? rec.toolCalls : []) {
      const call = asRecord(entry)
      const name = asString(call?.name)
      if (!call || !name) continue
      const callId = asString(call.id)
      window.emit({
        ...base,
        role: 'assistant',
        text: name,
        toolName: name,
        ...(callId ? { toolCallId: callId } : {}),
        ...(call.args === undefined ? {} : { toolInput: call.args }),
      })
      const output = toolOutputOf(call.result)
      if (output === undefined) continue
      window.emit({
        // A result is the tool speaking. It carries the call's id and not its name: the id is
        // what `resultFor` pairs on, and it is exact where a name is only adjacent.
        ...base,
        role: 'tool',
        text: clip(output, req.maxCharsPerEvent),
        ...(callId ? { toolCallId: callId } : {}),
      })
    }
  }
  return window.result()
}

export function turnStateFromGeminiDoc(
  doc: GeminiDoc | undefined,
  ref: SourceRef,
  now: number,
): TurnState | undefined {
  const messages = Array.isArray(doc?.messages) ? doc.messages : []
  const fresh = now - (ref.updatedAtHint ?? now) <= TURN_EVIDENCE_MS
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    const type = asString(message?.type)
    if (!type) continue
    // A notice is written when the turn is not running: "Request cancelled." is every one here.
    if (type === 'info' || type === 'error') return 'idle'
    if (type === 'user') return fresh ? 'working' : undefined
    if (type === 'gemini') {
      const calls = Array.isArray(message?.toolCalls) ? message.toolCalls : []
      const pending = calls.some((call) => asRecord(call)?.result === undefined)
      if (!pending) return 'idle'
      return fresh ? 'working' : undefined
    }
  }
  return undefined
}
