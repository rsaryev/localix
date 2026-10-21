import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const call = (name: string, input: unknown, output?: unknown): ToolCallItem => ({
  id: `${name}-1`,
  type: 'tool_call',
  status: output ? 'completed' : 'running',
  toolCallId: `tc-${name}-1`,
  name,
  input,
  activeVerb: 'reading',
  ...(output ? { output } : {}),
})

async function render(element: React.ReactElement, expand = true) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(element))
  if (expand) {
    await React.act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click(),
    )
  }
  return {
    host,
    dispose: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('a batched read card', () => {
  test('one row per file: its path, what was read, its text, or why it was not', async () => {
    const { ReadCard } = await import('./ReadCard')
    const item = call(
      'read',
      { reads: [{ path: 'src/a.ts', start_line: 2 }, { path: 'missing.ts' }, { path: 'big.txt' }] },
      {
        path: '/w/src/a.ts',
        bytes: 40,
        truncated: false,
        output: 'summary',
        items: [
          {
            path: '/w/src/a.ts',
            range: 'L2-end',
            bytes: 40,
            truncated: false,
            output: 'const a = 1',
          },
          {
            path: '/w/missing.ts',
            bytes: 0,
            truncated: false,
            output: 'File not found: /w/missing.ts',
            isError: true,
          },
          { path: '/w/big.txt', bytes: 0, truncated: false, output: '', skipped: true },
        ],
      },
    )
    const { host, dispose } = await render(<ReadCard item={item} />)
    try {
      const text = host.textContent ?? ''
      expect(text).toContain('3 files')
      expect(text).toContain('1 failed')
      expect(text).toContain('1 not shown')
      expect(text).toContain('/w/src/a.ts')
      expect(text).toContain('L2-end')
      expect(text).toContain('const a = 1')
      expect(text).toContain('File not found: /w/missing.ts')
      expect(text).toContain('over this call’s budget')
    } finally {
      await dispose()
    }
  })

  test('while it streams, the files the input names are listed', async () => {
    const { ReadCard } = await import('./ReadCard')
    const { host, dispose } = await render(
      <ReadCard item={call('read', { reads: ['a.ts', 'b.ts'] })} />,
      false,
    )
    try {
      expect(host.textContent).toContain('2 files')
      expect(host.textContent).toContain('Reading 2 files…')
    } finally {
      await dispose()
    }
  })

  test('a single read keeps the single-file card', async () => {
    const { ReadCard } = await import('./ReadCard')
    const item = call(
      'read',
      { path: 'one.ts' },
      { path: '/w/one.ts', bytes: 5, truncated: false, output: 'hello' },
    )
    const { host, dispose } = await render(<ReadCard item={item} />, false)
    try {
      expect(host.textContent).toContain('one.ts')
      expect(host.textContent).not.toContain('files')
    } finally {
      await dispose()
    }
  })
})

describe('a batched search card', () => {
  test('one section per query, with its hits or why there are none', async () => {
    const { SearchCard } = await import('./SearchCard')
    const item = call(
      'search',
      { queries: ['alpha', 'nothing'] },
      {
        query: 'alpha | nothing',
        cwd: '/w',
        bytes: 20,
        truncated: false,
        output: '',
        queries: [
          { query: 'alpha', cwd: '/w', bytes: 20, truncated: false, output: 'a.ts:1:alpha' },
          { query: 'nothing', cwd: '/w', bytes: 0, truncated: false, output: '' },
        ],
      },
    )
    const { host, dispose } = await render(<SearchCard item={item} />)
    try {
      const text = host.textContent ?? ''
      expect(text).toContain('`alpha`, `nothing`')
      expect(text).toContain('a.ts:1:alpha')
      expect(text).toContain('No matches')
    } finally {
      await dispose()
    }
  })
})
