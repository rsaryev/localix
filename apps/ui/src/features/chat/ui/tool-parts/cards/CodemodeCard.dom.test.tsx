import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const item: ToolCallItem = {
  id: 'codemode-1',
  type: 'tool_call',
  status: 'completed',
  toolCallId: 'tc-codemode-1',
  name: 'codemode',
  activeVerb: 'Running a script',
  input: { code: 'const out = await tools.bash({ command: "bun test" }); return out' },
  output: {
    calls: [
      { name: 'bash', args: { command: 'bun test' }, status: 'ok', durationMs: 5 },
      {
        name: 'read',
        args: { path: 'missing.ts' },
        status: 'error',
        durationMs: 1532,
        error: 'No such file: missing.ts',
      },
    ],
    complete: true,
  },
  resultText: '{"passed":12}',
}

async function render() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CodemodeCard } = await import('./CodemodeCard')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<CodemodeCard item={item} />))
  await React.act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click(),
  )
  return {
    host,
    dispose: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the codemode card', () => {
  test('numbers each call with what it was about, its outcome and its time', async () => {
    const { host, dispose } = await render()
    try {
      const text = host.textContent ?? ''
      expect(text).toContain('Script · bash, read')
      expect(text).toContain('2 calls · 1 failed')
      // Each row names the tool and its subject: the command run, the file read.
      expect(text).toContain('bashbun test5ms')
      expect(text).toContain('readmissing.tsfailed1.5s')
      expect(text).toContain('No such file: missing.ts')
      // The script's JSON report is indented for reading.
      expect(text).toContain('"passed": 12')
    } finally {
      await dispose()
    }
  })
})
