import { expect, test } from 'bun:test'
import { settingsFixture } from './testing/settings-fixture'
import { outputStyleSetting, settingsModes, skillShellDisabled } from './values'

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

test('the `outputStyle` setting: the higher file wins', () => {
  expect(outputStyleSetting(read({ user: { outputStyle: 'Explanatory' } }))).toBe('Explanatory')
  expect(
    outputStyleSetting(
      read({
        user: { outputStyle: 'Explanatory' },
        project: { outputStyle: 'Learning' },
        trusted: true,
      }),
    ),
  ).toBe('Learning')
})
