import type { Message } from '@/shared/api/contracts'

/**
 * Where a message sits in its run, and whether it opens a new day.
 *
 * Consecutive user messages may share a header. Assistant rows keep separate headers
 * unless the server explicitly links a mid-run steering split to its preceding row.
 */
export interface MessagePosition {
  /** Carries the author line. The rest of the run carries nothing but its content. */
  isFirstInGroup: boolean
  /** Carries the run's bottom spacing, so a group is one block with air after it. */
  isLastInGroup: boolean
  /** Set on the first message of a day; the card draws a divider above itself. */
  dayStart?: Date
}

/** A render row, not a persisted message: each segment retains its original identity and order. */
export interface MessageDisplayRow {
  segments: readonly Message[]
  firstIndex: number
}

/** Only explicit, adjacent-in-the-visible-projection assistant continuations share a card. */
export function messageDisplayRows(messages: readonly Message[]): MessageDisplayRow[] {
  const rows: { segments: Message[]; firstIndex: number }[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const previous = rows.at(-1)
    const last = previous?.segments.at(-1)
    if (previous && last && message.role === 'assistant' && !breaks(last, message)) {
      previous.segments.push(message)
    } else {
      rows.push({ firstIndex: index, segments: [message] })
    }
  }
  return rows
}

/**
 * A pause long enough that the next line is a new thought rather than the same one.
 *
 * Applies only to otherwise groupable user rows; assistant executions always have a header.
 */
const GROUP_GAP_MS = 10 * 60_000

/** Who said it, for grouping purposes. Role is the fallback for a row with no stored author. */
function speaker(message: Message): string {
  return message.from ?? message.role
}

/**
 * A row that is not somebody speaking — a notice, a mode divider, a command's output.
 *
 * These break a run on BOTH sides, which is the point: they are punctuation, and the voice
 * that resumes after one has to introduce itself again.
 */
function isPunctuation(message: Message): boolean {
  return Boolean(
    message.role === 'system' || message.uiOnly || message.systemNotice || message.commandOutput,
  )
}

function at(message: Message): number | undefined {
  if (!message.createdAt) return undefined
  const time = new Date(message.createdAt).getTime()
  return Number.isNaN(time) ? undefined : time
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * True when `next` starts a new run.
 *
 * A missing timestamp never breaks a run: an optimistic row has not round-tripped yet, and
 * splitting on that would put a header on the message you just sent and take it away again a
 * moment later.
 */
function breaks(previous: Message, next: Message): boolean {
  if (isPunctuation(previous) || isPunctuation(next)) return true
  // A split preserves chronological storage (assistant → internal report → assistant)
  // while both visible assistant rows still belong to the same execution. Never infer
  // this from proximity, source or speaker: a post-run wake can look identical.
  if (
    previous.role === 'assistant' &&
    next.role === 'assistant' &&
    next.continuedFromMessageId === previous.id &&
    speaker(previous) === speaker(next)
  )
    return false
  // Unlinked assistant rows are separate executions, including background wakes.
  if (previous.role === 'assistant' || next.role === 'assistant') return true
  if (speaker(previous) !== speaker(next)) return true
  const before = at(previous)
  const after = at(next)
  if (before === undefined || after === undefined) return false
  if (!sameDay(new Date(before), new Date(after))) return true
  return after - before > GROUP_GAP_MS
}

/**
 * One position per message, in the same order.
 *
 * An array rather than a map keyed by id: the caller has the index already, and a transcript
 * can hold two rows with the same id for one frame while an optimistic send is claimed.
 */
export function messagePositions(messages: readonly Message[]): MessagePosition[] {
  let lastDay: Date | undefined
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : undefined
    const next = index < messages.length - 1 ? messages[index + 1] : undefined
    const time = at(message)
    const day = time === undefined ? undefined : new Date(time)
    const opensDay = Boolean(day && (!lastDay || !sameDay(lastDay, day)))
    if (day) lastDay = day
    return {
      isFirstInGroup: !previous || breaks(previous, message),
      isLastInGroup: !next || breaks(message, next),
      ...(opensDay && day ? { dayStart: day } : {}),
    }
  })
}
