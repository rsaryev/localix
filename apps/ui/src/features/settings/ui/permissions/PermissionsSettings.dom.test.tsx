import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { stubElementWidth } from '@/testing/elementWidth'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const SNAPSHOT = {
  revision: 1,
  scope: { projectId: '', sessionId: null },
  plugins: [],
  miniApps: [],
  tools: {
    enabled: [],
    disabled: [],
    catalog: [],
    categoryLabels: {},
    mcp: [],
    mcpUnprobedServers: [],
  },
  views: [],
  panels: [],
  agents: [],
  commands: [],
  mcp: [],
  skills: [],
  grammar: { kinds: [], effects: [], classes: [], examples: [] },
  themes: [],
}

test('an old link to the permission rules opens Settings → Permissions with its picker', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { navigateSettings } = await import('@/shared/lib/settingsNavBus')
  const { SettingsPanel } = await import('../SettingsPanel')
  const { MemoryRouter } = await import('react-router')
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  __resetCapabilityCache()
  const spies = [
    spyOn(backendClient, 'listProjects').mockResolvedValue([]),
    spyOn(backendClient, 'listOutputStyles').mockResolvedValue([]),
    spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue(SNAPSHOT as never),
    spyOn(backendClient, 'fetchCapabilityRules').mockResolvedValue({
      scope: 'agent:localix',
      revision: 1,
      rules: [{ action: 'tool:bash', resource: 'git push*', effect: 'ask' }],
    } as never),
    spyOn(backendClient, 'fetchClaudeCodePermissions').mockResolvedValue({
      defaultMode: 'plan',
      bypassDisabled: false,
      rules: [{ effect: 'deny', rule: 'Bash(rm *)', file: '/home/me/.claude/settings.json' }],
    }),
  ]
  const unstub = stubElementWidth(1200)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsPanel />
        </MemoryRouter>,
      )
      await settle()
    })
    await act(async () => {
      navigateSettings('rules')
      await settle()
    })
    expect(container.querySelector('h1, h2')?.textContent).toBe('Permissions')
    expect(container.querySelector('[aria-label^="Agent whose rules to edit"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Permission rule 1"]')).not.toBeNull()
    expect(container.textContent).toContain('Bash(rm *)')
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Permissions')
  } finally {
    await act(async () => root.unmount())
    unstub()
    spies.forEach((spy) => spy.mockRestore())
    container.remove()
  }
})
