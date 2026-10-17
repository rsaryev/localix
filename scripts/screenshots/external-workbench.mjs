import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import {
  api,
  captureRoot,
  databaseFile,
  fixtureFile,
  repoRoot,
  uiOrigin,
  verifyDemoRuntime,
} from './runtime.mjs'
import { button } from './scenarios.mjs'

export async function seedExternal(fixture) {
  await verifyDemoRuntime()
  const root = path.join(captureRoot, 'cli-studio')
  await fs.mkdir(root, { recursive: true })
  await fs.cp(path.join(repoRoot, 'docs/assets/screenshots/fixtures/release-studio'), root, {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
  const config = path.join(root, '.capture-claude')
  await fs.mkdir(config, { recursive: true })
  // Disposable preferences, never copied from an authenticated account. The fixture is our code.
  await fs.writeFile(
    path.join(config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      autoUpdates: false,
      projects: { [await fs.realpath(root)]: { hasTrustDialogAccepted: true } },
    }),
  )
  await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify({ theme: 'dark' }))
  const all = await api('/projects')
  const project =
    (Array.isArray(all) ? all : all.projects).find((item) => item.workingDir === root) ??
    (await api('/projects', { name: 'CLI Studio', workingDir: root }))
  if (!fixture.externalSessionId) {
    const session = await api('/sessions', {
      title: 'Drive Claude Code through the terminal',
      projectId: project.id,
      agentIds: ['builtin:localix'],
    })
    fixture.externalSessionId = session.id
  }
  fixture.externalRoot = root
  fixture.externalProjectId = project.id
  const { Database } = await import('bun:sqlite')
  const { serializeMessagePayload } = await import('../../apps/api/src/db/payload-codec.ts')
  const db = new Database(databaseFile, { strict: true })
  try {
    const messages = [
      {
        role: 'user',
        content:
          '@localix Open Claude Code beside this chat. Keep the CLI ready for a release review.',
      },
      {
        role: 'assistant',
        content:
          '### Terminal control demo\n\nThe installed Claude Code CLI runs in a real terminal. Input goes to that terminal; its output comes back to Localix.\n\n1. Open the CLI in this workspace.\n2. Read the native startup screen.\n3. Continue in the same terminal when you connect your account.\n\n**Capture demo:** no account connected, no prompt sent to a model. The CLI keeps its own native session history.',
      },
    ]
    let parent = null
    for (const [index, message] of messages.entries()) {
      const id = `capture-external-${fixture.externalSessionId}-${index}`
      const payload = {
        id,
        role: message.role,
        content: message.content,
        ...(message.role === 'assistant'
          ? {
              from: 'agent:builtin:localix',
              authorSnapshot: { handle: 'localix' },
              items: [
                {
                  type: 'text',
                  id: `external-${index}`,
                  status: 'completed',
                  text: message.content,
                },
              ],
            }
          : {}),
      }
      db.query(
        'INSERT OR REPLACE INTO agent_messages(id,session_id,user_id,sequence,role,payload_json,parent_id) VALUES (?,?,?,?,?,?,?)',
      ).run(
        id,
        fixture.externalSessionId,
        'local-user',
        index + 1,
        message.role,
        serializeMessagePayload(payload),
        parent,
      )
      parent = id
    }
    db.query('UPDATE agent_sessions SET leaf_id=?,last_message_at=?,updated_at=? WHERE id=?').run(
      parent,
      new Date().toISOString(),
      new Date().toISOString(),
      fixture.externalSessionId,
    )
  } finally {
    db.close()
  }
}

export async function composeExternal(page, scenario) {
  if (scenario !== 'external-terminal') throw new Error(`Unknown external scenario: ${scenario}`)
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  for (const terminal of await api('/terminal')) {
    if (terminal.chatSessionId === fixture.externalSessionId)
      await api(`/terminal/${terminal.id}`, undefined, 'DELETE')
  }
  await page.goto(`${uiOrigin}/#/project/${fixture.externalProjectId}/${fixture.externalSessionId}`)
  await button(page, 'Add participant').waitFor()
  await button(page, 'Terminal').click()
  const input = page.getByRole('textbox', { name: 'Terminal input' })
  await input.fill(
    'clear; env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN CLAUDE_CONFIG_DIR="$PWD/.capture-claude" CLAUDE_CODE_HIDE_CWD=1 FORCE_COLOR=3 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 claude --bare --permission-mode default',
  )
  await input.press('Enter')
  const screen = page.locator('.xterm-rows')
  await expect(screen).toContainText('Claude Code')
}

export async function verifyExternal(page, scenario) {
  if (scenario !== 'external-terminal') throw new Error(`Unknown external scenario: ${scenario}`)
  await expect(page.getByText('Terminal control demo', { exact: true })).toBeVisible()
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const terminals = (await api('/terminal')).filter(
    (item) => item.chatSessionId === fixture.externalSessionId,
  )
  expect(terminals).toHaveLength(1)
  expect(terminals[0].altScreen).toBe(true)
  const screen = page.locator('.xterm-rows')
  await expect(screen).toContainText('Claude Code')
  await expect(screen).not.toContainText('For more help:')
  await expect(screen).not.toContainText('/private/')
  await expect(screen).not.toContainText('/Users/')
  await expect(page.getByText(/no account connected, no prompt sent to a model/)).toBeVisible()
  const viewport = await page.locator('.xterm-screen').boundingBox()
  expect(viewport.height).toBeGreaterThan(750)
  await expect(page.locator('.monaco-editor')).toHaveCount(0)
  // A linked chat is a Localix chat: it lists under the default Localix tab, not External.
  if (await page.getByRole('region', { name: 'Session history', exact: true }).isVisible()) {
    const sources = page.getByRole('tablist', { name: 'History source', exact: true })
    await expect(sources.getByRole('tab', { name: 'Localix', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator(`[data-session-row="${fixture.externalSessionId}"]`)).toBeVisible()
  }
}
