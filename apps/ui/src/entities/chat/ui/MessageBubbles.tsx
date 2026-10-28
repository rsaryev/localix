// The presentational message bubble used by MessageCard: text, with slash-command
// detection. Extracted from MessageCard so the card focuses on item batching + layout.
import { CommandMark } from './CommandMark'
import { MessageText } from './MessageText'
import { SLASH_COMMANDS, argConditionMet, type SlashArgSpec } from '@localixai/api/slash-catalog'

/**
 * Detects a slash command in a user message so it can render
 * as a labelled chip instead of raw glued text (e.g. "/usage" or "/model sonnet").
 */
export function detectCommand(content: string): { label: string; arg: string } | null {
  const slash = content.match(/^\/([a-z0-9][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i)
  if (!slash) return null
  const commandName = slash[1]!.toLowerCase()
  let remainder = (slash[2] ?? '').trim()
  const command = SLASH_COMMANDS.find(
    (candidate) => candidate.name === commandName || candidate.aliases?.includes(commandName),
  )
  if (!command?.args?.length) return { label: `/${slash[1]}`, arg: remainder }

  const labels = [`/${slash[1]}`]
  const values = new Map<string, string>()
  for (const spec of command.args) {
    if (spec.when && !argConditionMet(spec.when, values.get(spec.when.arg))) continue
    if (!isStructuralChoice(spec)) break
    const match = remainder.match(/^(\S+)(?:\s+([\s\S]*))?$/)
    if (!match) break
    const token = match[1]!
    const option = spec.options?.find((candidate) => candidate.value === token.toLowerCase())
    if (!option) break
    labels.push(option.label)
    values.set(spec.name, option.value)
    remainder = (match[2] ?? '').trim()
  }
  return { label: labels.join(' '), arg: remainder }
}

function isStructuralChoice(spec: SlashArgSpec): spec is Extract<SlashArgSpec, { type: 'choice' }> {
  return spec.type === 'choice' && !spec.dynamic
}

export function TextBubble({
  content,
  isUser,
  isStreaming,
}: {
  content: string
  isUser: boolean
  isStreaming?: boolean
}) {
  const command = isUser ? detectCommand(content) : null
  return (
    <div
      // Who wrote the text, for rules that belong to an agent's reply only (markdown.css: a
      // reply that opens with a `#` title centres it; a person's message never does).
      data-author={isUser ? 'user' : 'agent'}
      className={[
        'rounded-2xl text-sm leading-relaxed',
        isUser
          ? // A real container: its padding is the space between the text and its own edge.
            'max-w-[min(85%,44rem)] rounded-br-sm bg-user-message px-4 py-[0.7rem] text-foreground'
          : // No container, so no inset. Padding on a transparent box is not breathing room,
            // it is a third left edge — the card already has one, and the space between
            // stacked parts is the body column's gap. Line-height carries the rest.
            'w-full rounded-bl-sm bg-transparent text-text-strong',
      ].join(' ')}
    >
      {command ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <CommandMark label={command.label} className="text-sm leading-relaxed text-text-soft" />
          {command.arg && <span className="break-words leading-relaxed">{command.arg}</span>}
        </span>
      ) : (
        <MessageText text={content} isStreaming={isStreaming} linkifyMentions={isUser} />
      )}
    </div>
  )
}
