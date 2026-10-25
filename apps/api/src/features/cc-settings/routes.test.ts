import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createClaudeCodeSettingsRoutes } from './routes'

const scratch = tempDirPerTest('cc-settings-routes-')

function appOver(root: string) {
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  app.route(
    '/',
    createClaudeCodeSettingsRoutes({
      homeDir: join(root, 'home'),
      workingDir: async (_user, projectId) => (projectId === 'p1' ? join(root, 'project') : null),
    }),
  )
  return app
}

test('answers the rules of the person file and, with a project, of the project files', async () => {
  const root = scratch()
  writeTree(root, {
    'home/.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } }),
    'project/.claude/settings.local.json': JSON.stringify({
      permissions: { deny: ['Read(.env)'] },
    }),
  })
  const app = appOver(root)
  const bare = (await (await app.request('/permissions')).json()) as { rules: { rule: string }[] }
  expect(bare.rules.map((r) => r.rule)).toEqual(['Bash(rm *)'])
  const scoped = (await (await app.request('/permissions?projectId=p1')).json()) as {
    rules: { rule: string }[]
  }
  expect(scoped.rules.map((r) => r.rule).sort((a, b) => a.localeCompare(b))).toEqual([
    'Bash(rm *)',
    'Read(.env)',
  ])
})
