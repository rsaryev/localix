import { expect, test } from 'bun:test'
import { settingsCommandLine, settingsHooks } from './hooks'
import { settingsFixture } from './testing/settings-fixture'

const read = settingsFixture('kit-settings-hooks-')
const hooks = (command: string) => ({
  PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }],
})
const commandsOf = (blocks: ReturnType<typeof settingsHooks>['blocks']) =>
  blocks.map((block) => JSON.stringify(block.raw).match(/"command":"(\w+)"/)?.[1])

test("the person's and the organization's hooks load; a project's once trusted", () => {
  const tree = {
    user: { hooks: hooks('fmt') },
    project: { hooks: hooks('lint') },
    managed: { hooks: hooks('audit') },
  }
  const sources = (trusted: boolean) =>
    settingsHooks(read({ ...tree, trusted })).blocks.map((b) => b.source)
  expect(sources(false)).toEqual(['user', 'user'])
  expect(sources(true)).toEqual(['user', 'project', 'user'])
  expect(settingsHooks(read({ ...tree, trusted: true })).blocks.map((b) => b.managed)).toEqual([
    false,
    false,
    true,
  ])
})

test('managed disableAllHooks turns every hook off', () => {
  const off = settingsHooks(
    read({
      user: { hooks: hooks('fmt') },
      managed: { hooks: hooks('audit'), disableAllHooks: true },
    }),
  )
  expect(off.blocks).toEqual([])
  expect(off.pluginAllowed('any@market')).toBe(false)
})

// The kit: the highest file holding `disableAllHooks` decides; a person's own cannot reach managed hooks.
test("a person's disableAllHooks turns off what is not the organization's", () => {
  const mine = settingsHooks(
    read({
      user: { hooks: hooks('fmt'), disableAllHooks: true },
      managed: { hooks: hooks('audit') },
    }),
  )
  expect(commandsOf(mine.blocks)).toEqual(['audit'])
})

test('allowManagedHooksOnly keeps the organization’s hooks and the plugins it turns on', () => {
  const only = settingsHooks(
    read({
      user: { hooks: hooks('fmt') },
      managed: { allowManagedHooksOnly: true, enabledPlugins: { 'vetted@corp': true } },
    }),
  )
  expect(only.blocks).toEqual([])
  expect(only.pluginAllowed('vetted@corp')).toBe(true)
  expect(only.pluginAllowed('vetted')).toBe(true)
  expect(only.pluginAllowed('other')).toBe(false)
  expect(only.frontmatterAllowed('agent')).toBe(false)
  const open = settingsHooks(read({ user: { hooks: hooks('fmt') } }))
  expect(open.frontmatterAllowed('agent')).toBe(true)
  expect(open.frontmatterAllowed('skill')).toBe(true)
})

test('the http hook allowlists merge across settings files', () => {
  const policy = settingsHooks(
    read({
      user: { allowedHttpHookUrls: ['https://a.dev/*'] },
      managed: { allowedHttpHookUrls: ['https://b.dev/*'] },
    }),
  )
  expect(policy.httpHook('https://a.dev/x', []).run).toBe(true)
  expect(policy.httpHook('https://b.dev/x', []).run).toBe(true)
  expect(policy.httpHook('https://c.dev/x', []).run).toBe(false)
  expect(settingsHooks(read({})).httpHook('https://c.dev/x', []).run).toBe(true)
})

// settings-reference.md, `strictPluginOnlyCustomization.hooks`: hooks of user, project and local
// settings stop running; managed settings' hooks and every plugin's keep running.
test('a managed hooks lock keeps only the organization’s settings hooks and every plugin’s', () => {
  const lockedBy = (lock: unknown) =>
    settingsHooks(
      read({
        user: { hooks: hooks('fmt') },
        project: { hooks: hooks('lint') },
        local: { hooks: hooks('mine') },
        managed: {
          hooks: hooks('audit'),
          ...(lock === undefined ? {} : { strictPluginOnlyCustomization: lock }),
        },
        trusted: true,
      }),
    )
  expect(commandsOf(lockedBy(undefined).blocks)).toEqual(['fmt', 'lint', 'mine', 'audit'])
  expect(commandsOf(lockedBy(true).blocks)).toEqual(['audit'])
  expect(commandsOf(lockedBy(['hooks']).blocks)).toEqual(['audit'])
  expect(commandsOf(lockedBy(['skills', 'mcp']).blocks)).toEqual(['fmt', 'lint', 'mine', 'audit'])
  expect(lockedBy(true).pluginAllowed('any@market')).toBe(true)
})

test('a hooks lock a user or project file asks for is not a lock', () => {
  const tree = {
    user: { hooks: hooks('fmt'), strictPluginOnlyCustomization: true },
    project: { strictPluginOnlyCustomization: ['hooks'] },
    trusted: true,
  }
  expect(settingsHooks(read(tree)).blocks).toHaveLength(1)
})

test('the highest file that sets a status line applies, with its padding and refresh', () => {
  const line = (command: string, extra = {}) => ({
    statusLine: { type: 'command', command, ...extra },
  })
  const settings = read({
    user: line('mine'),
    project: line('team', { padding: 2.7, refreshInterval: 5 }),
    trusted: true,
  })
  expect(settingsCommandLine(settings, 'statusLine')).toEqual({
    command: 'team',
    padding: 2,
    refreshInterval: 5,
  })
  expect(settingsCommandLine(settings, 'subagentStatusLine')).toBeUndefined()
})

test('a status line waits for the folder’s trust and stops under managed disableAllHooks', () => {
  const line = { statusLine: { type: 'command', command: 'mine' } }
  expect(settingsCommandLine(read({ user: line }), 'statusLine')).toBeUndefined()
  expect(settingsCommandLine(read({ user: line, trusted: true }), 'statusLine')?.command).toBe(
    'mine',
  )
  expect(
    settingsCommandLine(
      read({ user: line, managed: { disableAllHooks: true }, trusted: true }),
      'statusLine',
    ),
  ).toBeUndefined()
})
