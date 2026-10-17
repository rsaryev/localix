/**
 * `@handle` — the one grammar for addressing an agent in message text.
 *
 * A shared leaf (`@localixai/api/agent-mentions`) because three places read the same rule and
 * must never disagree: the conversation strategy decides who answers from it, the composer offers
 * completions for it, and the transcript turns it into a link to the agent. Two copies of a
 * regex drift the way `wake-provenance`'s two copies once did, and a mention the composer
 * inserted but the conversation did not recognise would be the worst version of that.
 *
 * Matching is by the participants' handles, never by the text alone: `@2048` in "the @2048 game"
 * is not an agent, and "qa@example.com" is not a mention of @qa. A handle is what the registry says it
 * is, so the caller passes the handles it knows and this module only asks "which of these does
 * the text name".
 */

// The two reserved addresses — the person (`@human`) and everyone (`@all`) — are owned by the agent
// definition, which refuses them as agent handles; this grammar reads them like any other address.
import { ALL_MENTION_HANDLE, HUMAN_HANDLE } from '@localixai/agent/agents'

/**
 * A candidate mention: `@` after start-of-text or a character a handle cannot end with, then a
 * handle body.
 *
 * What may precede is defined by how a HANDLE is spelled — ASCII identifier characters — and not
 * by what is a letter, because every script has letters. A mention written in a script that puts
 * no space before it was invisible under the wider rule: the character in front of `@` was a
 * letter, so the candidate never matched and the participant was never named. What the narrow rule
 * still excludes is the case it was written for, an address inside a word (`qa@example.com`),
 * which is ASCII on both sides.
 */
const MENTION_CANDIDATE = /(^|[^A-Za-z0-9_@])@([\p{L}\p{N}][\p{L}\p{N}._:-]*)/gu

/** Trailing punctuation a mention is often followed by ("@qa," / "@qa.") — not part of the handle. */
const TRAILING_PUNCT = /[.,;:!?)]+$/u

function normalize(handle: string): string {
  return handle.toLowerCase()
}

/**
 * What may follow a handle without being part of it: anything that is not how a handle is
 * spelled. Handles are slugs — ASCII letters, digits, `.`, `_`, `-` — so a character outside
 * that set ENDS the handle even when it is a letter in its own script.
 */
const NOT_HANDLE_BODY = /^[^A-Za-z0-9._-]/u

/**
 * The known handle a candidate body starts with, when the body itself is not one.
 *
 * `@backend` written in a script that needs no space before the next word arrives here as
 * "backendです" — the candidate pattern cannot know where a handle ends, because every letter
 * of every script is a letter. The set of valid handles IS known, so the boundary is read from
 * it rather than guessed: the longest known handle that prefixes the body, provided what
 * follows is not something a handle could be spelled with. That last clause is what keeps
 * "@backends" from resolving to @backend while "@backend、" resolves.
 */
function knownPrefix(body: string, keys: Iterable<string>): string | undefined {
  let best: string | undefined
  for (const key of keys) {
    if (best !== undefined && key.length <= best.length) continue
    if (normalize(body.slice(0, key.length)) !== key) continue
    const rest = body.slice(key.length)
    if (rest.length > 0 && !NOT_HANDLE_BODY.test(rest)) continue
    best = key
  }
  return best
}

/**
 * Every known mention in `text`, in order, with its span — the ONE reading both public functions
 * below project. They used to read the candidates separately and disagreed: the span reader did
 * not try the known-prefix rule, so "@backendです" routed to @backend while the transcript drew no
 * chip for it.
 *
 * A handle may contain `:` (a plugin's `plugin:agent`, per `AGENT_HANDLE_PATTERN`). A body that
 * is not itself known falls back to its longest known prefix, which is also what lets
 * "@qa:" and "@backend:x" still name @qa and @backend.
 */
function readMentions(
  text: string,
  known: readonly string[],
): { start: number; end: number; handle: string; key: string }[] {
  if (!text.includes('@') || known.length === 0) return []
  const canonical = new Map(known.map((handle) => [normalize(handle), handle] as const))
  const found: { start: number; end: number; handle: string; key: string }[] = []
  for (const match of text.matchAll(MENTION_CANDIDATE)) {
    const body = match[2]!.replace(TRAILING_PUNCT, '')
    const key = canonical.has(normalize(body))
      ? normalize(body)
      : knownPrefix(body, canonical.keys())
    const handle = key === undefined ? undefined : canonical.get(key)
    if (!handle || key === undefined) continue
    const start = (match.index ?? 0) + match[1]!.length
    found.push({ start, end: start + 1 + key.length, handle, key })
  }
  return found
}

/**
 * The handles, among `known`, that `text` addresses — in order of first appearance, deduplicated,
 * returned in their CANONICAL spelling (the known handle, not what was typed).
 *
 * Case-insensitive because a handle is an identifier and people capitalise the start of a
 * sentence; "@QA" means @qa.
 */
export function mentionedHandles(text: string, known: readonly string[]): string[] {
  const seen = new Set<string>()
  return readMentions(text, known).flatMap(({ key, handle }) => {
    if (seen.has(key)) return []
    seen.add(key)
    return [handle]
  })
}

/**
 * Every address a conversation's text can name: its participants, plus everyone.
 *
 * For the surfaces that LINKIFY rather than route — the transcript renderer — so an `@all` in a
 * reply reads as the chip it is instead of plain text. The person is not an address (agents reach
 * them through `ask`), so `@human` stays plain text. The reserved handle goes last because
 * {@link mentionedHandles} canonicalises through a Map; no agent may carry it anyway.
 */
export function conversationMentionHandles(participantHandles: readonly string[]): string[] {
  return [...participantHandles, ALL_MENTION_HANDLE]
}

/**
 * Every `@handle` occurrence with its span, for a renderer that wants to replace the text
 * in place. Spans cover the `@` and the handle body, never the leading boundary character or
 * trailing punctuation.
 */
export function mentionSpans(
  text: string,
  known: readonly string[],
): { start: number; end: number; handle: string }[] {
  return readMentions(text, known).map(({ start, end, handle }) => ({ start, end, handle }))
}

const REGEXP_SYNTAX = /[.*+?^${}()|[\]\\]/g

/**
 * Plain occurrences of known agent handles in prose. This is intentionally separate from
 * {@link mentionSpans}: an explicit `@handle` is an address, while a bare name is only a weak
 * reference. Callers decide what that weaker signal means.
 *
 * Reserved conversation words are excluded, known handles win case-insensitively, and ASCII handle
 * boundaries prevent `pm` in an email or `lead` in `leader` from becoming a participant tag.
 */
export function agentNameSpans(
  text: string,
  known: readonly string[],
): { start: number; end: number; handle: string }[] {
  const canonical = new Map(
    known
      .filter((handle) => {
        const key = normalize(handle)
        return key !== HUMAN_HANDLE && key !== ALL_MENTION_HANDLE
      })
      .map((handle) => [normalize(handle), handle] as const),
  )
  if (canonical.size === 0) return []

  const alternatives = [...canonical.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((handle) => handle.replace(REGEXP_SYNTAX, '\\$&'))
    .join('|')
  const candidate = new RegExp(
    `(?<![A-Za-z0-9._@-])(${alternatives})(?![A-Za-z0-9_@-]|\\.[A-Za-z0-9])`,
    'giu',
  )
  const spans: { start: number; end: number; handle: string }[] = []
  for (const match of text.matchAll(candidate)) {
    const value = match[1]!
    const handle = canonical.get(normalize(value))
    if (!handle) continue
    const start = match.index ?? 0
    spans.push({ start, end: start + value.length, handle })
  }
  return spans
}
