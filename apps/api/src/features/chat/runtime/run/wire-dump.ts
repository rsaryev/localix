/**
 * Per-turn WIRE DUMP — a debug-only capture of the message list handed to the model
 * on each request, right AFTER `pruneWireMessages` crushing/elision. Built to validate
 * the effectiveness↔economy of the per-turn context: how many tokens, how much is
 * elided, and whether a read result that was sent in full earlier is now an "elided"
 * pointer (the signal behind endless-review re-read loops).
 *
 * CAPTURE LAYER: this is POST-prune but PRE `transformMessages`/`openai-serialize`, so
 * it's the exact input to the crushing layer (its purpose) — NOT byte-identical to the
 * final HTTP body. Downstream serialization additionally STRIPS prior-turn `thinking`
 * (openai-serialize.ts — reasoning is output-only, never re-sent, avoiding an O(turns²)
 * re-bill) and drops emptied messages, so the true wire is SMALLER than the totals here
 * by roughly the thinking-block tokens. Treat these numbers as an upper bound on the
 * real send; they're exact for the elision/crush behavior this tool exists to check.
 *
 * OFF by default and ZERO-cost when off. Turn it on by creating the flag file
 * `~/.localix/wire-dump.on` (stat cached ~2s) — `touch ~/.localix/wire-dump.on`,
 * `rm` it to stop. Deliberately a file and not an env var: it toggles against a
 * long-running `bun dev` with no restart, which is the whole point of the tool.
 * Dumps land under `~/.localix/tmp/wire-dump/<sessionId>/NNN.json`, one per request.
 * Inspect the serialized dump with any JSON viewer.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Message as WireMessage } from '@localixai/agent'

import { isWireDumpPointer } from './wire-dump-pointer'
import { localixHome } from '../../../../lib/env'

const DUMP_ROOT = path.join(localixHome(), 'tmp', 'wire-dump')
const FLAG_FILE = path.join(localixHome(), 'wire-dump.on')

const seqBySession = new Map<string, number>()

let flagCache = { at: 0, on: false }
function flagFileOn(): boolean {
  const now = Date.now()
  if (now - flagCache.at > 2000) {
    flagCache = { at: now, on: existsSync(FLAG_FILE) }
  }
  return flagCache.on
}

export function wireDumpEnabled(): boolean {
  return flagFileOn()
}

/** Best-effort role extraction across the wire message shapes. */
function roleOf(m: unknown): string {
  return (m as { role?: string })?.role ?? '?'
}

/**
 * Write one request's pruned wire to disk. Never throws (debug aid must not affect
 * a real turn). `messages` is the POST-prune list, pre provider-format transform.
 */
export function dumpWire(sessionId: string, model: string, messages: readonly WireMessage[]): void {
  try {
    const seq = (seqBySession.get(sessionId) ?? 0) + 1
    seqBySession.set(sessionId, seq)
    const dir = path.join(DUMP_ROOT, sessionId)
    mkdirSync(dir, { recursive: true })

    let total = 0
    let elidedTokens = 0
    const rows = messages.map((m, i) => {
      const s = JSON.stringify(m)
      const tokensEst = Math.ceil(s.length / 4)
      total += tokensEst
      const elided = isWireDumpPointer(s, tokensEst)
      if (elided) elidedTokens += tokensEst
      return {
        i,
        role: roleOf(m),
        tokensEst,
        elided,
        preview: s.length > 300 ? `${s.slice(0, 300)}…` : s,
      }
    })

    const entry = {
      seq,
      ts: new Date().toISOString(),
      sessionId,
      model,
      messageCount: messages.length,
      totalTokensEst: total,
      elidedMessages: rows.filter((r) => r.elided).length,
      elidedTokensEst: elidedTokens,
      messages: rows,
    }
    writeFileSync(
      path.join(dir, `${String(seq).padStart(3, '0')}.json`),
      JSON.stringify(entry, null, 2),
    )
  } catch {
    // swallow — never let a debug dump break a turn
  }
}

/**
 * The half of a request `dumpWire` cannot see: the system prompt and every tool schema's
 * size, written once per run as `fixed.json` beside the request dumps. This is where a
 * "why is the floor 11k" question gets its answer — per prompt section and per tool —
 * instead of a single number.
 */
export function dumpFixedContext(
  sessionId: string,
  systemPrompt: string,
  tools: readonly { name: string; tokens: number }[],
): void {
  try {
    const dir = path.join(DUMP_ROOT, sessionId)
    mkdirSync(dir, { recursive: true })
    const sections = systemPrompt
      .split(/\n(?=# )/)
      .map((section) => ({
        heading: section.split('\n')[0]!.slice(0, 80),
        tokensEst: Math.ceil(section.length / 4),
      }))
      .sort((a, b) => b.tokensEst - a.tokensEst)
    const entry = {
      ts: new Date().toISOString(),
      sessionId,
      promptTokensEst: Math.ceil(systemPrompt.length / 4),
      sections,
      tools: [...tools].sort((a, b) => b.tokens - a.tokens),
      systemPrompt,
    }
    writeFileSync(path.join(dir, 'fixed.json'), JSON.stringify(entry, null, 2))
  } catch {
    // debug aid — never let it affect the turn
  }
}
