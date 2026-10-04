import { describe, test, expect } from 'bun:test'
import { formatOutline, symbolKindName, type OutlineSymbol } from './outline'
import { createReadTool } from './read'
import type { ExecutionEnvironment } from '../environment'

const SYMBOLS: OutlineSymbol[] = [
  { name: 'AgentProfile', kind: 11, line: 9, endLine: 24, depth: 0 },
  {
    name: 'buildProfile',
    kind: 12,
    line: 30,
    endLine: 88,
    detail: '(role: Role) => AgentProfile',
    depth: 0,
  },
  { name: 'toolNames', kind: 13, line: 32, endLine: 32, depth: 1 },
]

describe('formatOutline', () => {
  test('renders indented, 1-based line spans', () => {
    const out = formatOutline('/x/a.ts', SYMBOLS)
    expect(out).toContain('Outline of /x/a.ts — 3 symbols')
    expect(out).toContain('interface AgentProfile [L10-25]')
    expect(out).toContain('function buildProfile [L31-89]  (role: Role) => AgentProfile')
    expect(out).toContain('  variable toolNames [L33]')
  })
  test('kind names cover the LSP range with a fallback', () => {
    expect(symbolKindName(5)).toBe('class')
    expect(symbolKindName(12)).toBe('function')
    expect(symbolKindName(99)).toBe('symbol')
  })
})

const fakeEnv = (content: string): ExecutionEnvironment =>
  ({
    readFile: async () => content,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 1 }),
  }) as unknown as ExecutionEnvironment

describe('read tool outline mode', () => {
  test('returns the formatted outline from the provider', async () => {
    const tool = createReadTool(fakeEnv('const x = 1\n'), '/x', async () => SYMBOLS)
    const r = await tool.execute('t1', { path: '/x/a.ts', mode: 'outline' } as never)
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('interface AgentProfile [L10-25]')
  })
  test('falls back to a bounded head (not an error, not the whole file) when no provider is wired', async () => {
    // A 500-line file: the fallback must show a bounded HEAD, never the full dump.
    const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const tool = createReadTool(fakeEnv(big), '/x')
    const r = await tool.execute('t1', { path: '/x/a.ts', mode: 'outline' } as never)
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('Outline unavailable')
    expect(r.content).toContain('showing the first')
    expect(r.content).toContain('line 1') // head is shown
    expect(r.content).not.toContain('line 500') // but bounded — not the whole file
  })
  test('falls back to a bounded head when the server returns no symbols', async () => {
    const tool = createReadTool(fakeEnv('plain text\n'), '/x', async () => [])
    const r = await tool.execute('t1', { path: '/x/notes.txt', mode: 'outline' } as never)
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('no symbols returned')
    expect(r.content).toContain('plain text')
  })
  test('default mode still returns file content', async () => {
    const tool = createReadTool(fakeEnv('const x = 1\n'), '/x', async () => SYMBOLS)
    const r = await tool.execute('t1', { path: '/x/a.ts' } as never)
    expect(r.content).toContain('const x = 1')
  })
})
