/**
 * Once a vault secret was typed into a tab, that tab refuses what the string shield cannot cover:
 * a screenshot (pixels) and `evaluate` (a transformed copy). Snapshots stay; moving to another
 * URL lifts it.
 */
import { describe, expect, test } from 'bun:test'
import { createBrowserTool, type BrowserToolDeps } from './browser'
import type { PreviewCommand, PreviewSendOutcome } from '../preview/preview-control'

const VALUE = 'hunter2-hunter2-hunter2'
const redact = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(VALUE).join('[vault-secret]'))

const snapshot = (url: string) => ({
  url,
  title: 't',
  tree: '- textbox "Password"',
  stats: { nodes: 1, interactive: 1, chars: 20 },
})

/** A page at `url.current`; `withUrl: false` models a probe that never reports an address. */
function harness(withUrl = true) {
  const sent: PreviewCommand[] = []
  const page = { url: 'https://x.test/login' }
  const deps: BrowserToolDeps = {
    async send(command): Promise<PreviewSendOutcome> {
      sent.push(command)
      if (command.action === 'steps' && command.steps?.some((s) => s.action === 'click'))
        page.url = 'https://x.test/home'
      const shot = withUrl ? { snapshot: snapshot(page.url) } : {}
      if (command.action === 'snapshot')
        return { ok: true, result: { action: 'snapshot', snapshot: snapshot(page.url) } }
      return { ok: true, result: { action: command.action as 'steps', ...shot } }
    },
    async openPreview() {
      throw new Error('not used')
    },
    closePreview() {},
    secrets: { resolve: async () => VALUE, redact },
  }
  return { tool: createBrowserTool(deps), sent, page }
}

const type = { action: 'type' as const, ref: 'e2', text: '${secret:K}' }
const typeIn = (tool: ReturnType<typeof harness>['tool']) =>
  tool.execute('t', { action: 'steps', steps: [type] })

describe('a tab that was typed a secret', () => {
  test('refuses a screenshot and evaluate, with the reason and what to do', async () => {
    const { tool, sent } = harness()
    await typeIn(tool)
    sent.length = 0
    const shot = await tool.execute('s', { action: 'take_screenshot' })
    const run = await tool.execute('e', { action: 'evaluate', expression: '1' })
    const step = await tool.execute('b', {
      action: 'steps',
      steps: [{ action: 'evaluate', expression: '1' }],
    })
    for (const result of [shot, run, step]) {
      expect(result.isError).toBe(true)
      expect(String(result.content)).toContain('Navigate')
    }
    expect(sent).toEqual([])
  })

  test('still reads: snapshot goes through', async () => {
    const { tool } = harness()
    await typeIn(tool)
    const result = await tool.execute('r', { action: 'snapshot' })
    expect(result.isError).toBeFalsy()
  })

  test('is free again once the tab is at another URL', async () => {
    const { tool, sent } = harness()
    await typeIn(tool)
    await tool.execute('c', { action: 'steps', steps: [{ action: 'click', ref: 'e3' }] })
    sent.length = 0
    const result = await tool.execute('s', { action: 'take_screenshot' })
    expect(String(result.content)).not.toContain('Refused')
    expect(sent.length).toBe(1)
  })

  test('stays refused for the run when no URL was ever known', async () => {
    const { tool } = harness(false)
    await typeIn(tool)
    await tool.execute('c', { action: 'steps', steps: [{ action: 'click', ref: 'e3' }] })
    const result = await tool.execute('s', { action: 'take_screenshot' })
    expect(result.isError).toBe(true)
  })

  test('a typing prelude lifted into a screenshot types, then does not photograph', async () => {
    const { tool, sent } = harness()
    const result = await tool.execute('s', { action: 'take_screenshot', steps: [type] })
    expect(result.isError).toBe(true)
    expect(sent.map((c) => c.action)).toEqual(['steps'])
    expect(sent[0]?.steps?.[0]?.text).toBe(VALUE)
  })

  test('typing and evaluating in one batch sends nothing', async () => {
    const { tool, sent } = harness()
    const result = await tool.execute('b', {
      action: 'steps',
      steps: [type, { action: 'evaluate', expression: '1' }],
    })
    expect(result.isError).toBe(true)
    expect(sent).toEqual([])
  })

  test('a tab never typed a secret is not affected', async () => {
    const { tool, sent } = harness()
    const result = await tool.execute('s', { action: 'take_screenshot' })
    expect(String(result.content)).not.toContain('Refused')
    expect(sent.length).toBe(1)
  })
})
