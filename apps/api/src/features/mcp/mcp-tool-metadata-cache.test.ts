import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readToolMetadataCache,
  writeToolMetadataCache,
  type ToolMetadataEntry,
} from './mcp-tool-metadata-cache'

async function withCacheFile(run: (file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-metadata-cache-'))
  try {
    await run(join(dir, 'cache.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const metadata: ToolMetadataEntry = {
  serverName: 'fixture',
  toolDefs: [{ name: 'echo', inputSchema: { type: 'object' } }],
}

test('metadata recovery drops invalid records and retains the last 128 valid entries', async () => {
  await withCacheFile(async (file) => {
    await writeFile(file, '{invalid')
    expect(readToolMetadataCache(file).size).toBe(0)
    await writeFile(file, JSON.stringify({ version: 2, entries: [['key', metadata]] }))
    expect(readToolMetadataCache(file).size).toBe(0)
    const entries = Array.from({ length: 130 }, (_, index): [string, ToolMetadataEntry] => [
      `key-${index}`,
      metadata,
    ])
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [
          null,
          ['bad', { serverName: 'fixture', toolDefs: [{ name: 'bad', inputSchema: [] }] }],
          ...entries,
        ],
      }),
    )
    expect([...readToolMetadataCache(file).keys()]).toEqual(entries.slice(2).map(([key]) => key))
  })
})

test('metadata writing replaces the cache with a value-preserving restricted file', async () => {
  await withCacheFile(async (file) => {
    const entries = new Map([['key', metadata]])
    await writeFile(file, 'old contents')
    writeToolMetadataCache(file, entries)
    expect([...readToolMetadataCache(file)]).toEqual([...entries])
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
    expect(await readdir(join(file, '..'))).toEqual(['cache.json'])
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
})

test('metadata write failures warn without discarding the in-memory entries', async () => {
  await withCacheFile(async (file) => {
    await writeFile(file, 'existing file')
    const entries = new Map([['key', metadata]])
    const warnings: string[] = []
    writeToolMetadataCache(join(file, 'nested.json'), entries, {
      warn: (message) => warnings.push(message),
    })
    expect(warnings).toEqual(['Failed to persist MCP tool metadata cache'])
    expect(entries.get('key')).toBe(metadata)
    expect(await readFile(file, 'utf8')).toBe('existing file')
  })
})

test('a channel server stays marked across launches, so it starts with the next chat', async () => {
  await withCacheFile(async (file) => {
    writeToolMetadataCache(
      file,
      new Map([
        ['channel', { ...metadata, channel: true }],
        ['plain', metadata],
      ]),
    )
    const read = readToolMetadataCache(file)
    expect(read.get('channel')?.channel).toBe(true)
    expect(read.get('plain')).toEqual(metadata)
  })
})
