import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { boundedReaderText, createReaderResearchTool } from './research-tool'
import { ReaderService } from './service'

function toolFor(service: ReaderService) {
  const context = {
    z,
    defineTool: ((definition: unknown) => definition) as MiniAppContext['defineTool'],
  } as unknown as MiniAppContext
  return createReaderResearchTool(context, service)
}

describe('reader_research', () => {
  test('keeps sequential chunks contiguous across Unicode surrogate pairs', () => {
    const source = `${'a'.repeat(999)}🙂${'b'.repeat(1_000)}`
    const first = boundedReaderText(source, 1_000)
    const second = boundedReaderText(source, 1_000, first.nextOffset ?? 0)
    const third = boundedReaderText(source, 1_000, second.nextOffset ?? 0)

    expect(first.nextOffset).toBe(999)
    expect(first.content + second.content + third.content).toBe(source)
    expect([first.content, second.content, third.content].join('')).not.toContain('�')
    expect(third.nextOffset).toBeNull()
  })

  test('retrieves only explicitly opened books and keeps chapter reads bounded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-research-'))
    const opened = join(root, 'opened.md')
    const unopened = join(root, 'unopened.md')
    await writeFile(
      opened,
      `# Observable systems\n\n${'Agents exchange evidence through a shared mesh. Every claim points back to a source. '.repeat(80)}\n\n## Grounding\n\nEvery claim remains inspectable.`,
    )
    await writeFile(unopened, '# Private draft\n\nThis file was never opened.')
    const openedRealPath = await realpath(opened)
    const service = new ReaderService()
    await service.read(root, opened)
    const tool = toolFor(service)

    const library = await tool.execute('library', { action: 'library' })
    expect(library.isError).toBeUndefined()
    expect(JSON.parse(library.content).books).toEqual([
      expect.objectContaining({
        title: 'Observable systems',
        source: { path: openedRealPath },
      }),
    ])

    const outline = await tool.execute('outline', {
      action: 'outline',
      source: { path: opened },
    })
    expect(JSON.parse(outline.content).chapters[0]).toMatchObject({
      index: 0,
      title: 'Observable systems',
    })

    const read = await tool.execute('read', {
      action: 'read',
      source: { path: opened },
      chapter: 0,
      offset: 0,
      maxChars: 1_000,
    })
    const passage = JSON.parse(read.content)
    expect(passage.content.length).toBeLessThanOrEqual(1_000)
    expect(passage.truncated).toBe(true)
    expect(passage.offset).toBe(0)
    expect(passage.nextOffset).toBe(passage.content.length)

    const continued = await tool.execute('read-next', {
      action: 'read',
      source: { path: opened },
      chapter: 0,
      offset: passage.nextOffset,
      maxChars: 1_000,
    })
    const nextPassage = JSON.parse(continued.content)
    expect(nextPassage.offset).toBe(passage.nextOffset)
    expect(nextPassage.content.length).toBeGreaterThan(0)
    expect(nextPassage.offset + nextPassage.content.length).toBe(nextPassage.nextOffset)

    const search = await tool.execute('search', {
      action: 'search',
      source: { path: opened },
      query: 'shared mesh',
      limit: 3,
    })
    expect(JSON.parse(search.content)).toMatchObject({ total: 3, truncated: true })

    const refused = await tool.execute('read', {
      action: 'read',
      source: { path: unopened },
      chapter: 0,
      offset: 0,
      maxChars: 1_000,
    })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('not in the explicit Reader library')
  })
})
