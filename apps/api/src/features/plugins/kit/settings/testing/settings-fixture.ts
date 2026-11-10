import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { readClaudeSettingsSync, type ClaudeSettings } from '../read'

/**
 * A home, a project and a managed folder holding the given settings files, read as a session in
 * the project reads them. `trusted` accepts the project's trust dialog in the state file.
 */
export interface SettingsTree {
  user?: Record<string, unknown>
  project?: Record<string, unknown>
  local?: Record<string, unknown>
  managed?: Record<string, unknown>
  trusted?: boolean
}

export function settingsFixture(prefix: string) {
  const scratch = tempDirPerTest(prefix)
  let count = 0
  return (tree: SettingsTree): ClaudeSettings & { root: string } => {
    // Each read gets its own folder, so one test can compare several trees.
    const root = join(realpathSync(scratch()), String(count++))
    mkdirSync(root)
    const project = join(root, 'project')
    const json = (value: unknown) => JSON.stringify(value)
    writeTree(root, {
      'project/.keep': '',
      ...(tree.user ? { 'home/.claude/settings.json': json(tree.user) } : {}),
      ...(tree.project ? { 'project/.claude/settings.json': json(tree.project) } : {}),
      ...(tree.local ? { 'project/.claude/settings.local.json': json(tree.local) } : {}),
      ...(tree.managed ? { 'managed/managed-settings.json': json(tree.managed) } : {}),
      ...(tree.trusted
        ? {
            'home/.claude.json': json({
              projects: { [project]: { hasTrustDialogAccepted: true } },
            }),
          }
        : {}),
    })
    const settings = readClaudeSettingsSync({
      homeDir: join(root, 'home'),
      cwd: project,
      env: {},
      managed: { dir: join(root, 'managed') },
    })
    return Object.assign(settings, { root })
  }
}
