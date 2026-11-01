/**
 * A typed `${secret:KEY}` reaches the page and goes no further. The host resolves the reference
 * for that one value right before the relay; what the page sends back is shielded, so the model
 * never reads what it typed.
 */
import { describe, expect, test } from 'bun:test'
import { createBrowserTool, type BrowserToolDeps } from './browser'
import type { PreviewCommand, PreviewSendOutcome } from '../preview/preview-control'

const VALUE = 'hunter2-hunter2-hunter2'
const redact = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(VALUE).join('[vault-secret]'))

function harness(reply: (command: PreviewCommand) => PreviewSendOutcome, vault = true) {
  const sent: PreviewCommand[] = []
  const resolved: string[] = []
  const deps: BrowserToolDeps = {
    async send(command) {
      sent.push(command)
      return reply(command)
    },
    async openPreview() {
      throw new Error('not used')
    },
    closePreview() {},
    ...(vault
      ? {
          secrets: {
            resolve: async (key: string) => {
              resolved.push(key)
              return key === 'SITE_PASSWORD' ? VALUE : undefined
            },
            redact,
          },
        }
      : {}),
  }
  return { tool: createBrowserTool(deps), sent, resolved }
}

const echoing = (): PreviewSendOutcome => ({
  ok: true,
  result: {
    action: 'steps',
    value: `field now holds ${VALUE}`,
    snapshot: {
      url: 'https://x.test/',
      title: 'x',
      tree: `textbox "Password" value="${VALUE}"`,
      stats: { nodes: 1, interactive: 1, chars: 40 },
    },
  },
})

const typePassword = (text: string) => ({
  action: 'steps' as const,
  steps: [{ action: 'type' as const, ref: 'e2', text }],
})

describe('browser vault references', () => {
  test('the page receives the value, the model does not see it', async () => {
    const { tool, sent } = harness(echoing)
    const result = await tool.execute('c1', typePassword('${secret:SITE_PASSWORD}'))
    expect(sent[0]?.steps?.[0]?.text).toBe(VALUE)
    expect(JSON.stringify(result)).not.toContain(VALUE)
    expect(JSON.stringify(result)).toContain('[vault-secret]')
  })

  test('a reference inside longer text is resolved in place', async () => {
    const { tool, sent } = harness(echoing)
    await tool.execute('c2', typePassword('pw:${secret:SITE_PASSWORD}!'))
    expect(sent[0]?.steps?.[0]?.text).toBe(`pw:${VALUE}!`)
  })

  test('an unknown key fails before anything reaches the page', async () => {
    const { tool, sent } = harness(echoing)
    const result = await tool.execute('c3', typePassword('${secret:NOPE}'))
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('NOPE')
    expect(sent).toEqual([])
  })

  test('without a vault the reference is refused, never typed literally', async () => {
    const { tool, sent } = harness(echoing, false)
    const result = await tool.execute('c4', typePassword('${secret:SITE_PASSWORD}'))
    expect(result.isError).toBe(true)
    expect(sent).toEqual([])
  })

  test('a failure that echoes the value is shielded too', async () => {
    const { tool } = harness(() => ({
      ok: false,
      error: `could not type ${VALUE}`,
      errorCode: 'failed',
    }))
    const result = await tool.execute('c5', typePassword('${secret:SITE_PASSWORD}'))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain(VALUE)
  })

  test('a reference outside a typed value is not resolved, and the result says so', async () => {
    const { tool, sent, resolved } = harness(() => ({
      ok: true,
      result: { action: 'evaluate', value: '"done"' },
    }))
    const result = await tool.execute('c6', {
      action: 'evaluate',
      expression: 'document.title + "${secret:SITE_PASSWORD}"',
    })
    expect(sent[0]?.expression).toContain('${secret:SITE_PASSWORD}')
    expect(resolved).toEqual([])
    expect(String(result.content)).toContain('not resolved')
  })

  test('a select step is not a typing step either', async () => {
    const { tool, sent } = harness(echoing)
    const result = await tool.execute('c7', {
      action: 'steps',
      steps: [{ action: 'select', ref: 'e2', text: '${secret:SITE_PASSWORD}' }],
    })
    expect(sent[0]?.steps?.[0]?.text).toBe('${secret:SITE_PASSWORD}')
    expect(String(result.content)).toContain('not resolved')
  })
})
