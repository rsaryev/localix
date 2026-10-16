// remark plugin: turn `@handle` in message text into a link node the renderer maps to a
// clickable agent chip. Sibling of `remarkFileMention`, same shape: a custom `agent:` scheme
// so the `a` component can tell it apart from files and ordinary URLs.
//
// WHICH `@` is an agent is decided by the shared grammar (`@localixai/api/agent-mentions`),
// against the handles the caller knows — the same rule the conversation strategy uses to decide who
// answers first and the composer uses to complete. Three readers, one regex.
import { visit } from 'unist-util-visit'
import type { Root, Text, Link, InlineCode } from 'mdast'
import { HUMAN_HANDLE } from '@localixai/agent/agents'
import { agentNameSpans, mentionSpans } from '@localixai/api/agent-mentions'

export function agentHref(handle: string): string {
  return `agent:${encodeURIComponent(handle)}`
}

/**
 * The person's own mention gets its OWN scheme, not the agent one.
 *
 * `@human` is a participant like the others and matches through the same grammar, but it is not
 * a conversation agent — there is no participant profile to open. An `agent:` href for it would
 * send the one chip that is about the reader to a lookup that must fail.
 */
export function humanMentionHref(): string {
  return 'human:'
}

/** Is this href the person's own mention? */
export function isHumanMentionHref(href?: string): boolean {
  return href === 'human:'
}

/** Decodes an `agent:` href back to its handle, or null if not an agent mention. */
export function agentHandleFromHref(href?: string): string | null {
  if (!href || !href.startsWith('agent:')) return null
  try {
    return decodeURIComponent(href.slice('agent:'.length))
  } catch {
    return null
  }
}

/**
 * A mention the writer wrapped in backticks is still a mention.
 *
 * Models write handles as code — "available: `@lead`, `@qa`" — and markdown puts that in an
 * `inlineCode` node, which has a value rather than children, so the text pass below never sees
 * it. The result was a room where every mention an agent wrote rendered as a grey code pill and
 * none of them could be clicked, while the same handle typed by the person linked fine: the
 * person's composer does not wrap anything in backticks. One chip for one gesture, wherever it
 * was written.
 *
 * Only when the WHOLE span is one mention. `` `@lead` `` is a participant; `` `grep @lead src/` ``
 * is a command, and a chip in the middle of a command line would be a lie about what to type.
 * A fenced code block is a different node (`code`) and is never touched.
 */
function codeMention(node: InlineCode, handles: readonly string[]): string | null {
  const value = node.value.trim()
  const spans = mentionSpans(value, handles)
  const only = spans[0]
  return spans.length === 1 && only?.start === 0 && only.end === value.length ? only.handle : null
}

function mentionLink(handle: string, label: string): Link {
  return {
    type: 'link',
    url: handle.toLowerCase() === HUMAN_HANDLE ? humanMentionHref() : agentHref(handle),
    children: [{ type: 'text', value: label }],
  }
}

export function remarkAgentMention(
  handles: readonly string[],
  options: { linkifyBareNames?: boolean } = {},
) {
  return () => (tree: Root) => {
    if (handles.length === 0) return
    visit(tree, 'inlineCode', (node: InlineCode, index, parent) => {
      if (index === undefined || !parent || parent.type === 'link') return
      const handle = codeMention(node, handles)
      if (!handle) return
      parent.children.splice(index, 1, mentionLink(handle, `@${handle}`))
    })
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || !parent || parent.type === 'link') return
      const value = node.value
      const spans = [
        ...mentionSpans(value, handles),
        ...(options.linkifyBareNames ? agentNameSpans(value, handles) : []),
      ].sort((a, b) => a.start - b.start || a.end - b.end)
      if (spans.length === 0) return

      const replacements: (Text | Link)[] = []
      let lastEnd = 0
      for (const span of spans) {
        if (span.start > lastEnd) {
          replacements.push({ type: 'text', value: value.slice(lastEnd, span.start) })
        }
        replacements.push(mentionLink(span.handle, value.slice(span.start, span.end)))
        lastEnd = span.end
      }
      if (lastEnd < value.length) {
        replacements.push({ type: 'text', value: value.slice(lastEnd) })
      }
      parent.children.splice(index, 1, ...replacements)
      return index + replacements.length
    })
  }
}
