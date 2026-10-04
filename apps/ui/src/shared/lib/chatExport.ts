import type { AgentItem } from '@localixai/agent/agents'
import type { Message, MessageBinding } from '@/shared/api/contracts'
import { saveViaDesktop, webDownloadBlob } from './desktopSave'

export interface ExportOptions {
  /**
   * Privacy-safe export: the conversation
   * prose and turn structure are KEPT, while payload-bearing parts are replaced
   * with typed placeholders — tool calls become `[tool: bash — completed · redacted]`
   * (name + status survive, inputs/outputs don't), attachments and composer
   * @-ref file expansions become `[attachment: …]` / `[context: redacted]` lines.
   * Code blocks the model wrote inside its prose are kept — they're authored
   * explanation, not payload; payload data lives in tool IO/attachments, which
   * are stripped. Tools-only turns (skipped by the plain export) ARE included
   * here as placeholder timelines, so the shareable dump shows what happened.
   */
  redacted?: boolean
}

/** One placeholder line for a tool-backed item: keep tool name + status only. */
function redactedToolLine(item: AgentItem): string | undefined {
  switch (item.type) {
    case 'command':
    case 'file_change':
    case 'mcp_call':
    case 'tool_call':
      return `> \`[tool: ${item.name} — ${item.status} · redacted]\``
    // Narrative items are handled by the caller.
    case 'text':
    case 'reasoning':
      return undefined
  }
}

/** Placeholder for an attachment; @-ref context expansions get their own tag. */
function redactedBindingLine(binding: MessageBinding): string {
  if (binding.kind === 'context') return '> `[context: redacted]`'
  if (binding.kind === 'invocation')
    return `> \`[invocation: ${binding.invocation.kind} — redacted]\``
  return `> \`[attachment: ${binding.kind} — redacted]\``
}

/**
 * Body of one message in redacted mode: prose interleaved with tool placeholders
 * (from the ordered item list when present), plus attachment placeholders.
 */
function redactedBody(m: Message): string {
  const lines: string[] = []
  for (const binding of m.bindings ?? []) lines.push(redactedBindingLine(binding))
  if (m.items?.length) {
    for (const item of m.items) {
      if (item.type === 'text') {
        const text = item.text.trim()
        if (text) lines.push(text)
        continue
      }
      const tool = redactedToolLine(item)
      if (tool) lines.push(tool)
      // reasoning/plan: verbose model-internal narrative — omitted, as in the plain export.
    }
  } else {
    const text = (m.content ?? '').trim()
    if (text) lines.push(text)
  }
  return lines.join('\n\n')
}

/**
 * Serialize a conversation to portable Markdown. Uses each message's `content`
 * — the same field the per-message Copy action reads — so an export matches what
 * you'd get copying each turn by hand. Non-conversational rows are skipped:
 * system notices/dividers (`role === 'system'`), internal continuation prompts
 * (`isInternal`), UI-only markers (`uiOnly`), and empty-text messages (e.g. an
 * assistant turn that only ran tools).
 *
 * With `{ redacted: true }` the export becomes a privacy-safe structured dump —
 * see {@link ExportOptions.redacted}.
 */
export function sessionToMarkdown(
  session: { title?: string | null; messages: Message[] },
  options?: ExportOptions,
): string {
  const title = session.title?.trim() || 'Conversation'
  const out: string[] = [`# ${title}`, '']
  for (const m of session.messages) {
    if (m.isInternal || m.uiOnly || m.role === 'system') continue
    const body = options?.redacted ? redactedBody(m) : (m.content ?? '').trim()
    if (!body) continue
    out.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}`, '', body, '')
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`
}

/**
 * A filesystem-safe `.md` filename derived from the conversation title. Unicode
 * letters/digits are PRESERVED (so a non-Latin title slugs to a meaningful name,
 * not the generic fallback) — only punctuation/whitespace collapses to `-`.
 * An optional `suffix` is appended after the slug (e.g. `-redacted`).
 */
export function exportFileName(title: string | null | undefined, suffix?: string): string {
  const base =
    (title ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'conversation'
  return `${base}${suffix ? `-${suffix}` : ''}.md`
}

/** Save text content: native save dialog under the desktop shell, else a web download. */
export function downloadTextFile(filename: string, text: string, mime = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  if (saveViaDesktop(filename, blob)) return
  webDownloadBlob(filename, blob)
}
