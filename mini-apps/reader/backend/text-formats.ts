import {
  MAX_CHAPTERS,
  chapter,
  cleanText,
  documentFromChapters,
  titleFromPath,
  type ParsedReaderDocument,
} from './chapters'

function markdownText(value: string): string {
  return cleanText(
    value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/[*_~>#]/g, ''),
  )
}

export function splitMarkdown(path: string, source: string): ParsedReaderDocument {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const titleLine = lines.find((line) => /^#\s+/.test(line))
  const title = titleLine?.replace(/^#\s+/, '').trim() || titleFromPath(path)
  const parts: Array<{ title: string; lines: string[] }> = []
  let current = { title, lines: [] as string[] }
  for (const line of lines) {
    const heading = /^#{1,2}\s+(.+?)\s*#*$/.exec(line)
    if (heading && current.lines.some((item) => item.trim())) {
      parts.push(current)
      current = { title: heading[1]!.trim(), lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.some((line) => line.trim())) parts.push(current)
  const chapters = parts.map((part, index) => {
    const content = part.lines.join('\n').trim()
    return chapter(index, part.title, 'markdown', content, markdownText(content))
  })
  return documentFromChapters(path, 'md', title, chapters)
}

export function splitPlainText(path: string, source: string): ParsedReaderDocument {
  const normalized = source.replace(/\r\n?/g, '\n').trim()
  const lines = normalized.split('\n')
  const boundary =
    /^(?:chapter|part|\u0433\u043b\u0430\u0432\u0430|\u0447\u0430\u0441\u0442\u044c)\s+[\p{L}\d-]+(?:[.:\s—-].*)?$/iu
  const parts: Array<{ title: string; body: string[] }> = []
  let current = { title: titleFromPath(path), body: [] as string[] }
  for (const line of lines) {
    if (boundary.test(line.trim()) && current.body.some((item) => item.trim())) {
      parts.push(current)
      current = { title: line.trim(), body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.some((item) => item.trim())) parts.push(current)
  if (parts.length === 1 && normalized.length > 45_000) {
    parts.length = 0
    let offset = 0
    while (offset < normalized.length && parts.length < MAX_CHAPTERS) {
      const target = Math.min(normalized.length, offset + 28_000)
      const breakAt = normalized.lastIndexOf('\n\n', target)
      const end = breakAt > offset + 8_000 ? breakAt : target
      parts.push({
        title: `Part ${parts.length + 1}`,
        body: [normalized.slice(offset, end)],
      })
      offset = end
    }
  }
  const title = titleFromPath(path)
  return documentFromChapters(
    path,
    'txt',
    title,
    parts.map((part, index) => {
      const text = cleanText(part.body.join('\n'))
      return chapter(index, part.title, 'text', text, text)
    }),
  )
}
