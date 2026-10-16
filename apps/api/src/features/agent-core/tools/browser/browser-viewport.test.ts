import { describe, expect, test } from 'bun:test'
import { createBrowserTool } from './browser'
import type { PreviewCommand, PreviewSendOutcome } from '../preview/preview-control'
import type { OpenPreviewCoreInput, OpenPreviewCoreResult } from '../preview/open-preview'

const snapshot = (viewport: { width: number; height: number }): PreviewSendOutcome => ({
  ok: true,
  result: {
    action: 'snapshot',
    previewId: 'tab-a',
    viewport,
    snapshot: {
      url: 'http://x',
      title: 'X',
      tree: '- a',
      stats: { nodes: 9, interactive: 0, chars: 3 },
    },
  },
})

function harness(open: Partial<Extract<OpenPreviewCoreResult, { ok: true }>> = {}) {
  const sent: PreviewCommand[] = []
  const opens: OpenPreviewCoreInput[] = []
  const tool = createBrowserTool({
    async send(command) {
      sent.push(command)
      if (command.action === 'viewport')
        return {
          ok: true,
          result: {
            action: 'viewport',
            previewId: command.previewId,
            viewport: command.viewport ?? { width: 900, height: 700 },
          },
        }
      return snapshot(command.viewport ?? { width: 900, height: 700 })
    },
    async openPreview(input) {
      opens.push(input)
      return {
        ok: true,
        url: 'http://127.0.0.1:4173/',
        previewId: 'tab-a',
        title: 'X',
        version: 1,
        frameBlocked: false,
        autoServed: false,
        content: 'Opened Browser tab: http://127.0.0.1:4173/',
        ...open,
      }
    },
    closePreview() {},
  })
  return { tool, sent, opens }
}

describe('a fixed viewport belongs to the tab until the agent resets it', () => {
  test('later commands carry the size, so a snapshot after viewport measures it', async () => {
    const { tool, sent } = harness()
    await tool.execute('v', {
      action: 'viewport',
      preview_id: 'tab-a',
      viewport: { width: 320, height: 740 },
    })
    const result = await tool.execute('s', { action: 'snapshot', preview_id: 'tab-a' })
    expect(sent[1]).toEqual({
      action: 'snapshot',
      previewId: 'tab-a',
      viewport: { width: 320, height: 740 },
    })
    expect(result.content).toContain('Actual CSS viewport: 320 × 740')
    expect(result.content).toContain('"viewport":null')
  })

  test('viewport null returns the tab to responsive and stops carrying a size', async () => {
    const { tool, sent } = harness()
    await tool.execute('v', {
      action: 'viewport',
      preview_id: 'tab-a',
      viewport: { width: 320, height: 740 },
    })
    await tool.execute('r', { action: 'viewport', preview_id: 'tab-a', viewport: null })
    const result = await tool.execute('s', { action: 'snapshot', preview_id: 'tab-a' })
    expect(sent.at(-1)).toEqual({ action: 'snapshot', previewId: 'tab-a' })
    expect(result.content).not.toContain('Fixed viewport')
  })

  test('open without a size is responsive; with a size it pins until reset', async () => {
    const { tool, sent, opens } = harness()
    const pinned = await tool.execute('o1', {
      action: 'open',
      url: 'http://127.0.0.1:4173/',
      viewport: { width: 1120, height: 820 },
    })
    expect(pinned.content).toContain('Fixed viewport 1120 × 820')
    const responsive = await tool.execute('o2', { action: 'open', url: 'http://127.0.0.1:4173/' })
    expect(opens.at(-1)?.viewport).toBeUndefined()
    expect(sent.at(-1)).toEqual({ action: 'snapshot', previewId: 'tab-a' })
    expect(responsive.content).not.toContain('Fixed viewport')
  })
})

describe('open names a page that did not load', () => {
  test('an unreachable local server is reported with what to check', async () => {
    const sent: PreviewCommand[] = []
    const tool = createBrowserTool({
      async send(command) {
        sent.push(command)
        return { ok: false, errorCode: 'probe_not_ready', error: 'probe not ready' }
      },
      async openPreview() {
        return {
          ok: true,
          url: 'http://127.0.0.1:4173/',
          previewId: 'tab-a',
          title: 'X',
          version: 1,
          frameBlocked: false,
          autoServed: false,
          content: 'Opened Browser tab: http://127.0.0.1:4173/',
          unreachable: 'connection refused',
        }
      },
      closePreview() {},
    })
    const result = await tool.execute('o', { action: 'open', url: 'http://127.0.0.1:4173/' })
    expect(result.content).toContain('The page did not load')
    expect(result.content).toContain('connection refused')
    expect(result.content).toContain('server is still running')
    expect(result.details?.ready).toBe(false)
  })
})
