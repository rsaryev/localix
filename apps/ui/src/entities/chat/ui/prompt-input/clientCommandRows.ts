import { SLASH_COMMANDS } from '@localixai/api/slash-catalog'
import { sessionRef } from '@localixai/api/session-ref'
import type { Message, UiSession } from '@/shared/api/contracts'
import { copyableRowText } from '../../model/copyableRowText'
import { messageDisplayRows } from '../../model/messageGroups'
import { isSwitchTarget } from '../../model/switchTargets'
import { createTranscriptProjectionSelector } from '../transcriptProjection'
import type { SlashArgOption } from './SlashArgSpec'

/**
 * The live rows behind the dynamic crumbs of `/rewind`, `/copy`, `/resume` and `/help`. Each reads
 * what the app already shows: the transcript as its cards group it, the roster the session
 * switcher lists, the commands the menu lists. A crumb is a suggestion — a typed value is
 * accepted as it is — so these only filter and order.
 */

const PREVIEW_CHARS = 60
const MAX_ROWS = 40

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const preview = (text: string) => {
  const line = oneLine(text)
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}…` : line
}
const matches = (query: string, ...texts: (string | undefined)[]) => {
  const q = query.trim().toLowerCase()
  return !q || texts.some((text) => text?.toLowerCase().includes(q))
}

/** The transcript as the cards show it, one row per card. */
const cards = (messages: readonly Message[]) =>
  messageDisplayRows(createTranscriptProjectionSelector()(messages))

/** The messages you wrote that the transcript shows, newest first. */
export function rewindOptions(messages: readonly Message[], query: string): SlashArgOption[] {
  return cards(messages)
    .map((row) => row.segments[0]!)
    .filter((message) => message.role === 'user')
    .reverse()
    .map((message, index) => ({
      value: message.id,
      label: preview(message.content ?? '') || 'Message with attachments',
      description: index === 0 ? 'Latest message' : undefined,
    }))
    .filter((row) => matches(query, row.label))
    .slice(0, MAX_ROWS)
}

/** The text of each assistant reply the transcript shows, newest first. */
function replies(messages: readonly Message[]): string[] {
  return cards(messages)
    .filter((row) => row.segments[0]!.role === 'assistant')
    .flatMap((row) => copyableRowText(row.segments) ?? [])
    .reverse()
}

export function copyOptions(messages: readonly Message[], query: string): SlashArgOption[] {
  return replies(messages)
    .map((text, index) => ({
      value: String(index + 1),
      label: preview(text),
      description: index === 0 ? 'Latest reply' : undefined,
    }))
    .filter((row) => matches(query, row.label, row.value))
    .slice(0, MAX_ROWS)
}

/** The nth latest reply as its card's Copy text copies it; null when there is no such reply. */
export function replyText(messages: readonly Message[], n: number): string | null {
  return replies(messages)[n - 1] ?? null
}

/** The other chats the session switcher offers, most recent first. */
export function resumeOptions(
  sessions: readonly UiSession[],
  activeId: string | null,
  query: string,
): SlashArgOption[] {
  return sessions
    .filter((session) => isSwitchTarget(session) && session.id !== activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => {
      const ref = session.seq ? sessionRef(session.seq) : ''
      return {
        value: session.id,
        label: session.title?.trim() || ref || 'Untitled Chat',
        description: ref || undefined,
      }
    })
    .filter((row) => matches(query, row.label, row.description))
    .slice(0, MAX_ROWS)
}

/** The commands the menu lists, for `/help <command>`. */
export function helpOptions(query: string): SlashArgOption[] {
  return SLASH_COMMANDS.filter((command) => !command.hidden)
    .map((command) => ({
      value: command.name,
      label: `/${command.name}`,
      description: command.title,
    }))
    .filter((row) => matches(query, row.value))
}
