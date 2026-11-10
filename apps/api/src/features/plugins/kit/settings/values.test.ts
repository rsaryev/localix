import { expect, test } from 'bun:test'
import { settingsFixture } from './testing/settings-fixture'
import {
  customizationLocks,
  mainAgentSetting,
  outputStyleSetting,
  settingsModes,
  skillShellDisabled,
} from './values'

const read = settingsFixture('kit-settings-values-')
const perms = (permissions: object) => ({ permissions })

test('disableSkillShellExecution from any file; a managed true cannot be turned off', () => {
  expect(skillShellDisabled(read({}))).toBe(false)
  expect(skillShellDisabled(read({ user: { disableSkillShellExecution: true } }))).toBe(true)
  expect(
    skillShellDisabled(read({ project: { disableSkillShellExecution: true }, trusted: true })),
  ).toBe(true)
  expect(skillShellDisabled(read({ user: { disableSkillShellExecution: 'yes' } }))).toBe(false)
  const managed = { disableSkillShellExecution: true }
  expect(skillShellDisabled(read({ user: { disableSkillShellExecution: false }, managed }))).toBe(
    true,
  )
})

test('strictPluginOnlyCustomization: managed true locks every kind, an array the named ones', () => {
  const locks = (value: unknown) =>
    [...customizationLocks(read({ managed: { strictPluginOnlyCustomization: value } }))].sort()
  expect(locks(true)).toEqual(['agents', 'hooks', 'mcp', 'skills'])
  expect(locks(['skills', 'hooks'])).toEqual(['hooks', 'skills'])
  expect(customizationLocks(read({})).size).toBe(0)
  const own = read({
    user: { strictPluginOnlyCustomization: true },
    project: { strictPluginOnlyCustomization: ['mcp'] },
  })
  expect(customizationLocks(own).size).toBe(0)
})

test('defaultMode names the starting mode; the project file wins over the user file', () => {
  const both = read({
    user: perms({ defaultMode: 'bypassPermissions' }),
    project: perms({ defaultMode: 'plan' }),
    trusted: true,
  })
  expect(settingsModes(both)).toEqual({ defaultMode: 'plan', bypassDisabled: false })
  expect(settingsModes(read({ user: perms({ defaultMode: 'bypassPermissions' }) }))).toEqual({
    defaultMode: 'bypass',
    bypassDisabled: false,
  })
  // No Localix mode means the same as acceptEdits: the conversation starts in Default.
  expect(settingsModes(read({ user: perms({ defaultMode: 'acceptEdits' }) }))).toEqual({
    bypassDisabled: false,
  })
})

test('disableBypassPermissionsMode holds from any file', () => {
  const settings = read({
    user: perms({ disableBypassPermissionsMode: 'disable' }),
    local: perms({ defaultMode: 'bypassPermissions' }),
  })
  expect(settingsModes(settings).bypassDisabled).toBe(true)
  expect(settingsModes(settings).defaultMode).not.toBe('bypass')
})

// permission-modes.md: `auto` and `bypassPermissions` take no effect from project or local files,
// and the session then starts in the built-in default, not in the user file's mode.
test('bypassPermissions and auto from a project or local file start the built-in default', () => {
  for (const scope of ['project', 'local'] as const)
    for (const mode of ['bypassPermissions', 'auto']) {
      const tree = {
        user: perms({ defaultMode: 'plan' }),
        [scope]: perms({ defaultMode: mode }),
        trusted: true,
      }
      expect(['default', undefined]).toContain(settingsModes(read(tree)).defaultMode)
    }
})

test('the `agent` and `outputStyle` settings: the higher file wins, a blank one is none', () => {
  expect(
    mainAgentSetting(
      read({ user: { agent: 'reviewer' }, project: { agent: 'auditor' }, trusted: true }),
    ),
  ).toBe('auditor')
  expect(mainAgentSetting(read({ user: { agent: 'reviewer' } }))).toBe('reviewer')
  expect(mainAgentSetting(read({ user: { agent: '  ' } }))).toBeUndefined()
  expect(mainAgentSetting(read({}))).toBeUndefined()
  expect(outputStyleSetting(read({ user: { outputStyle: 'Explanatory' } }))).toBe('Explanatory')
})
