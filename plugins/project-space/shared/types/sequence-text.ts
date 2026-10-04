/**
 * A sequence diagram's TEXT form: the subset of Mermaid's `sequenceDiagram` every model and most
 * people already write — participants, actors, and three kinds of message. Reading and writing
 * are exact inverses for the shapes this board draws, so the agent can send Mermaid, a person can
 * edit the diagram as text, and a pasted Mermaid block lands as a native diagram.
 *
 * | Mermaid      | Message   | Drawn as                         |
 * | ------------ | --------- | -------------------------------- |
 * | `A->>B: t`   | `sync`    | solid line, filled head          |
 * | `A-)B: t`    | `async`   | solid line, open head            |
 * | `A-->>B: t`  | `return`  | dashed line, open head           |
 *
 * Lines it does not draw (`autonumber`, `activate`, `Note`, comments) are skipped, not errors.
 */
export type ParticipantKind = 'participant' | 'actor' | 'database'
export type MessageKind = 'sync' | 'async' | 'return'

export interface SequenceParticipant {
  id: string
  label?: string
  kind: ParticipantKind
}

export interface SequenceMessage {
  from: string
  to: string
  text: string
  kind: MessageKind
}

export interface SequenceContent {
  title: string
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
}

const DECLARE = /^(participant|actor|database)\s+(.+?)(?:\s+as\s+(.+))?$/u
// The longest arrow first, so `-->>` is not read as `-->` plus `>`.
const MESSAGE = /^(.+?)\s*(-->>|->>|--\)|-\)|-->|->)\s*(.+?)\s*:\s*(.*)$/u
const KIND: Record<string, MessageKind> = {
  '->>': 'sync',
  '->': 'sync',
  '-)': 'async',
  '--)': 'async',
  '-->>': 'return',
  '-->': 'return',
}
const ARROW: Record<MessageKind, string> = { sync: '->>', async: '-)', return: '-->>' }

export function readSequence(text: string): SequenceContent | string {
  const content: SequenceContent = { title: '', participants: [], messages: [] }
  const declared = new Map<string, SequenceParticipant>()
  const ensure = (id: string) => {
    if (!declared.has(id)) {
      const participant: SequenceParticipant = { id, kind: 'participant' }
      declared.set(id, participant)
      content.participants.push(participant)
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (
      !line ||
      line.startsWith('%%') ||
      line === 'sequenceDiagram' ||
      line === '```' ||
      line.startsWith('```')
    )
      continue
    if (line.startsWith('title ')) {
      content.title = line.slice(6).trim()
      continue
    }
    const declaration = DECLARE.exec(line)
    if (declaration) {
      const [, kind, id, label] = declaration as unknown as [
        string,
        ParticipantKind,
        string,
        string?,
      ]
      ensure(id.trim())
      const participant = declared.get(id.trim()) as SequenceParticipant
      participant.kind = kind
      if (label?.trim()) participant.label = label.trim()
      continue
    }
    const message = MESSAGE.exec(line)
    if (message) {
      const [, from, arrow, to, said] = message as unknown as [
        string,
        string,
        string,
        string,
        string,
      ]
      ensure(from.trim())
      ensure(to.trim())
      content.messages.push({
        from: from.trim(),
        to: to.trim(),
        text: said.trim(),
        kind: KIND[arrow] as MessageKind,
      })
    }
  }
  if (content.participants.length === 0)
    return 'no participants or messages; write lines like "participant API" and "Web->>API: POST /tasks"'
  return content
}

export function writeSequence(content: SequenceContent): string {
  const lines = ['sequenceDiagram']
  if (content.title) lines.push(`  title ${content.title}`)
  for (const participant of content.participants)
    lines.push(
      `  ${participant.kind} ${participant.id}${participant.label && participant.label !== participant.id ? ` as ${participant.label}` : ''}`,
    )
  for (const message of content.messages)
    lines.push(`  ${message.from}${ARROW[message.kind]}${message.to}: ${message.text}`)
  return lines.join('\n')
}

/**
 * One line of the text split into what it IS, for the editor's colours — read with the same two
 * patterns `readSequence` reads with, so a line coloured as a message is a line drawn as one.
 */
export type SequenceTokenKind = 'keyword' | 'name' | 'arrow' | 'label' | 'comment' | 'plain'
export interface SequenceToken {
  text: string
  kind: SequenceTokenKind
}

export function sequenceLineTokens(line: string): SequenceToken[] {
  const indent = /^\s*/u.exec(line)?.[0] ?? ''
  const body = line.slice(indent.length)
  const lead: SequenceToken[] = indent ? [{ text: indent, kind: 'plain' }] : []
  if (body.startsWith('%%')) return [...lead, { text: body, kind: 'comment' }]
  if (body === 'sequenceDiagram') return [...lead, { text: body, kind: 'keyword' }]
  if (body.startsWith('title ')) {
    return [...lead, { text: 'title', kind: 'keyword' }, { text: body.slice(5), kind: 'label' }]
  }
  const declaration = DECLARE.exec(body)
  if (declaration) {
    const [, kind, id, label] = declaration as unknown as [string, string, string, string?]
    const tokens: SequenceToken[] = [...lead, { text: kind, kind: 'keyword' }]
    const rest = body.slice(kind.length)
    const at = rest.indexOf(id)
    tokens.push({ text: rest.slice(0, at), kind: 'plain' }, { text: id, kind: 'name' })
    const tail = rest.slice(at + id.length)
    if (label !== undefined) {
      const as = tail.indexOf('as')
      tokens.push(
        { text: tail.slice(0, as), kind: 'plain' },
        { text: 'as', kind: 'keyword' },
        { text: tail.slice(as + 2), kind: 'label' },
      )
    } else if (tail) tokens.push({ text: tail, kind: 'plain' })
    return tokens
  }
  const message = MESSAGE.exec(body)
  if (message) {
    const [, from, arrow] = message as unknown as [string, string, string]
    const arrowAt = body.indexOf(arrow, from.length)
    const colon = body.indexOf(':', arrowAt + arrow.length)
    return [
      ...lead,
      { text: body.slice(0, arrowAt), kind: 'name' },
      { text: arrow, kind: 'arrow' },
      { text: body.slice(arrowAt + arrow.length, colon), kind: 'name' },
      { text: ':', kind: 'plain' },
      { text: body.slice(colon + 1), kind: 'label' },
    ]
  }
  return [...lead, { text: body, kind: 'plain' }]
}

/** Whether pasted text is a Mermaid sequence diagram. */
export const isSequenceText = (text: string) =>
  /^\s*(?:```\s*mermaid\s*\n)?\s*sequenceDiagram\b/u.test(text)
