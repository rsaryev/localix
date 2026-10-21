import type { Message } from '../model/types'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

function messageKey(message: Message): string | undefined {
  if (message.role !== 'system') return undefined
  const notice = message.systemNotice
  if (!notice && !message.commandOutput && !message.content && !message.items?.length) {
    return undefined
  }
  return JSON.stringify(
    canonicalValue({
      from: message.from,
      uiOnly: Boolean(message.uiOnly),
      notice: notice && {
        kind: notice.kind,
        tone: notice.tone,
        text: notice.text,
        mode: notice.mode,
        recovery: notice.recovery ?? [],
        activityState: notice.activity?.state,
      },
      commandOutput: message.commandOutput,
      ...(!notice && !message.commandOutput
        ? {
            content: message.content,
            items: message.items?.map(({ id: _id, ...item }) => item),
          }
        : {}),
    }),
  )
}

/** Collapse only adjacent equal system messages in display order. Dates and ids are irrelevant. */
export function coalesceSystemMessages(messages: readonly Message[]): Message[] {
  const projected: Message[] = []
  let previousKey: string | undefined
  for (const message of messages) {
    const key = messageKey(message)
    const first = projected.at(-1)
    if (key === undefined || key !== previousKey || !first) {
      projected.push(message)
    } else {
      const details = [first.systemNotice?.detail, message.systemNotice?.detail].filter(
        (detail): detail is string => Boolean(detail),
      )
      projected[projected.length - 1] = {
        ...first,
        systemRepeatCount: (first.systemRepeatCount ?? 1) + (message.systemRepeatCount ?? 1),
        ...(first.systemNotice
          ? {
              systemNotice: {
                ...first.systemNotice,
                detail:
                  [...new Set(details.flatMap((detail) => detail.split('\n')))].join('\n') ||
                  undefined,
              },
            }
          : {}),
      }
    }
    previousKey = key
  }
  return projected
}

export function systemMessageLabel(text: string, count = 1): string {
  return count > 1 ? `${text} ×${count}` : text
}

export function needsSystemMessageAttention(message: Message): boolean {
  const notice = message.systemNotice
  return Boolean(
    notice?.tone === 'warning' ||
    notice?.tone === 'error' ||
    notice?.recovery?.length ||
    notice?.activity?.state === 'failed',
  )
}

export function isSystemActivity(message: Message): boolean {
  return Boolean(message.systemNotice?.activity) && !needsSystemMessageAttention(message)
}

/** Group adjacent routine events without losing their causal order inside the disclosure. */
export function groupSystemActivity(messages: readonly Message[]): Message[] {
  const projected: Message[] = []
  for (const message of messages) {
    if (!isSystemActivity(message)) {
      projected.push(message)
      continue
    }
    const previous = projected.at(-1)
    if (previous?.systemActivity) {
      projected[projected.length - 1] = {
        ...previous,
        systemActivity: [...previous.systemActivity, message],
      }
    } else {
      projected.push({ ...message, systemActivity: [message] })
    }
  }
  return projected
}
