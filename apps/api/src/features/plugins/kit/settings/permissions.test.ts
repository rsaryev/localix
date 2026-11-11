import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { settingsAdditionalDirectories, settingsRuleEntries } from './permissions'
import { settingsFixture } from './testing/settings-fixture'

const read = settingsFixture('kit-settings-permissions-')
test('each rule in force, with the file it came from and where its paths anchor', () => {
  const settings = read({
    user: { permissions: { allow: ['Read'] } },
    project: { permissions: { deny: ['Bash(rm *)'] } },
  })
  const [deny, allow] = settingsRuleEntries(settings)
  expect(deny).toEqual({
    effect: 'deny',
    raw: 'Bash(rm *)',
    file: join(settings.root, 'project', '.claude', 'settings.json'),
    sourceDir: join(settings.root, 'project'),
    scope: 'project',
  })
  expect(allow).toMatchObject({
    effect: 'allow',
    raw: 'Read',
    sourceDir: join(settings.root, 'home', '.claude'),
  })
})

test('additional directories resolve against home and the working folder, once each', () => {
  const settings = read({
    user: { permissions: { additionalDirectories: ['~/notes', 'shared', ' ', '/srv/x'] } },
    local: { permissions: { additionalDirectories: ['/srv/x'] } },
  })
  expect(settingsAdditionalDirectories(settings).sort()).toEqual(
    [
      join(settings.root, 'home', 'notes'),
      join(settings.root, 'project', 'shared'),
      '/srv/x',
    ].sort(),
  )
})
