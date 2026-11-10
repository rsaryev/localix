import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { settingsAdditionalDirectories, settingsRuleEntries } from './permissions'
import { settingsFixture } from './testing/settings-fixture'

const read = settingsFixture('kit-settings-permissions-')
const rules = (settings: ReturnType<typeof read>) =>
  settingsRuleEntries(settings).map((one) => `${one.effect}:${one.raw}`)

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

test("a project's allow rules wait for the folder's trust; its deny rules hold at once", () => {
  const tree = { project: { permissions: { allow: ['Bash(ls)'], deny: ['WebFetch'] } } }
  expect(rules(read(tree))).toEqual(['deny:WebFetch'])
  expect(rules(read({ ...tree, trusted: true }))).toEqual(['deny:WebFetch', 'allow:Bash(ls)'])
})

test('allowManagedPermissionRulesOnly keeps the organization’s rules and folders alone', () => {
  const settings = read({
    user: { permissions: { allow: ['Read'], additionalDirectories: ['/srv/mine'] } },
    managed: {
      allowManagedPermissionRulesOnly: true,
      permissions: { ask: ['Bash'], additionalDirectories: ['/srv/org'] },
    },
  })
  expect(rules(settings)).toEqual(['ask:Bash'])
  expect(settingsAdditionalDirectories(settings)).toEqual(['/srv/org'])
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
