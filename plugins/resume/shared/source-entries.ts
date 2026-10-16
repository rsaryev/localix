import { emptyEntry, type ResumeEntry, type SectionType } from './schema'
import { markdownBody } from './markdown'
const range =
  /((?:\d{4}(?:-\d{2})?|[A-Za-z]{3,9}\s+\d{4}))\s*[–—-]\s*((?:\d{4}(?:-\d{2})?|[A-Za-z]{3,9}\s+\d{4}|Present|Current|Sekarang))/iu
function date(value: string): string {
  if (/^\d{4}(?:-\d{2})?$/u.test(value)) return value
  const [month, year] = value.toLowerCase().split(/\s+/u)
  const index = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ].indexOf(month.slice(0, 3))
  return index >= 0 ? `${year}-${String(index + 1).padStart(2, '0')}` : ''
}
/** Only dates and short adjacent title lines are inferred; all other prose stays verbatim. */
export function sourceEntries(lines: string[], type: SectionType): ResumeEntry[] {
  if (type === 'summary' || type === 'custom')
    return [{ ...emptyEntry(), body: markdownBody(lines.join('\n')) }]
  const groups: string[][] = []
  let current: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (range.test(line) && current.some((value) => range.test(value))) {
      const previous = current.at(-1)
      const title =
        previous?.trim() && !/^[-*•]/u.test(previous) && previous.split(/\s+/u).length <= 10
          ? current.pop()
          : undefined
      groups.push(current)
      current = title ? [title, line] : [line]
    } else current.push(line)
  }
  if (current.some((line) => line.trim())) groups.push(current)
  return groups.map((group) => {
    const entry = emptyEntry()
    const index = group.findIndex((line) => range.test(line))
    if (index < 0) {
      entry.body = markdownBody(group.join('\n'))
      return entry
    }
    const match = range.exec(group[index])!
    entry.start = date(match[1])
    entry.current = /^(Present|Current|Sekarang)$/iu.test(match[2])
    entry.end = entry.current ? '' : date(match[2])
    const title = group[index].replace(range, '').replace(/^[\s·|,-]+|[\s·|,-]+$/gu, '')
    const before = group[index - 1]?.trim()
    const after = group[index + 1]?.trim()
    const short = (value: string | undefined) =>
      Boolean(value && !/^[-*•]/u.test(value) && value.split(/\s+/u).length <= 10)
    const used = new Set([index])
    if (title) entry.title = title
    else if (short(before)) {
      entry.title = before!
      used.add(index - 1)
    }
    if (entry.title && short(after)) {
      entry.organization = after!
      used.add(index + 1)
    }
    entry.body = markdownBody(group.filter((_, i) => !used.has(i)).join('\n'))
    return entry
  })
}
