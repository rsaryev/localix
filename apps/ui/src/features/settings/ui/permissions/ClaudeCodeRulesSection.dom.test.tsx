import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function render(answer: object | Error) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  const { ClaudeCodeRulesSection } = await import('./ClaudeCodeRulesSection')
  const read = spyOn(backendClient, 'fetchClaudeCodePermissions')
  if (answer instanceof Error) read.mockRejectedValue(answer)
  else read.mockResolvedValue(answer as never)
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ClaudeCodeRulesSection projectId="p1" />
      </SWRConfig>,
    )
    await settle()
  })
  return {
    container,
    read,
    done: async () => {
      read.mockRestore()
      await act(async () => root.unmount())
    },
  }
}

test('shows the mode and every rule, a deny before an ask before an allow, with its file', async () => {
  const view = await render({
    defaultMode: 'acceptEdits',
    bypassDisabled: true,
    rules: [
      { effect: 'allow', rule: 'Read', file: '/home/me/.claude/settings.json' },
      { effect: 'deny', rule: 'Bash(rm *)', file: '/home/me/.claude/settings.json' },
      { effect: 'ask', rule: 'Bash(git push *)', file: '/work/app/.claude/settings.json' },
    ],
  })
  try {
    expect(view.read).toHaveBeenCalledWith('p1')
    const text = view.container.textContent ?? ''
    expect(text).toContain('acceptEdits')
    expect(text).toContain('Bypass mode is disabled')
    expect(text).toContain('/work/app/.claude/settings.json')
    const order = ['Bash(rm *)', 'Bash(git push *)', 'Read'].map((rule) => text.indexOf(rule))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  } finally {
    await view.done()
  }
})

test('says so when the settings files hold no rules', async () => {
  const view = await render({ defaultMode: null, bypassDisabled: false, rules: [] })
  try {
    expect(view.container.textContent).toContain('No permission rules in your Claude Code settings')
    expect(view.container.textContent).toContain('not set')
  } finally {
    await view.done()
  }
})

test('says when the settings could not be read, never an empty list', async () => {
  const view = await render(new Error('boom'))
  try {
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not read your Claude Code settings',
    )
    expect(view.container.textContent).not.toContain('No permission rules')
  } finally {
    await view.done()
  }
})
