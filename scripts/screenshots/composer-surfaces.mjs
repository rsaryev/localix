import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { seedAgentCommand } from './agent-command.mjs'
import { openConversation } from './fixture-chat.mjs'
import { api, captureRoot, repoRoot, uiOrigin, verifyDemoRuntime } from './runtime.mjs'

/**
 * What Claude Code's own files add around the composer: the status line under the message box, the
 * prompts of an MCP server and a plugin that waits for its OK in the slash menu. All of it lives in
 * one project folder of its own, so no other capture's composer shows any of it, and in that
 * folder's own files (`.claude/settings.json`, `.localix/plugins`) and the project's own MCP
 * registry, never in a person's home. The MCP server is `mcp-prompts-server.mjs`, started by the
 * runtime as any stdio server is; the status line is a script that prints what it prints.
 */
const TITLE = 'Release prep'
const MCP_NAME = 'release'
const PLUGIN = 'release-helper'
const folder = () => path.join(captureRoot, 'claude-code-surfaces')

// Two rows, as a script of a person's writes them: colors, a dim separator and an OSC 8 link.
const STATUS_SCRIPT = `#!/usr/bin/env bash
printf '\\033[1;32m● main\\033[0m \\033[2m·\\033[0m \\033[33m3 changed\\033[0m \\033[2m·\\033[0m \\033[36m↑1 to push\\033[0m\\n'
printf '\\033[2mchecks\\033[0m \\033[32m12 passing\\033[0m \\033[2m·\\033[0m \\033[31m1 failing\\033[0m \\033[2m·\\033[0m \\033]8;;https://example.com/release-studio/pull/42\\033\\\\\\033[4;34mPR #42\\033[0m\\033]8;;\\033\\\\\\n'
`

async function writeFolder() {
  const root = folder()
  const files = {
    '.claude/settings.json': `${JSON.stringify(
      { statusLine: { type: 'command', command: 'bash .claude/statusline.sh' } },
      null,
      2,
    )}\n`,
    '.claude/statusline.sh': STATUS_SCRIPT,
    [`.localix/plugins/${PLUGIN}/.claude-plugin/plugin.json`]: `${JSON.stringify(
      {
        name: PLUGIN,
        version: '1.0.0',
        description: 'Draft release notes and check the changelog before a release',
      },
      null,
      2,
    )}\n`,
    [`.localix/plugins/${PLUGIN}/commands/ship.md`]:
      '---\ndescription: Check the changelog and draft the release notes\n---\nCheck CHANGELOG.md, then draft the notes.\n',
    'README.md': 'Fixture folder for the composer-surfaces captures.\n',
  }
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), content)
  }
  return root
}

const listOf = (answer, key) => (Array.isArray(answer) ? answer : (answer[key] ?? []))

/** Find or make the project and its conversation, and make the MCP server answer. Repeatable. */
export async function seedComposerSurfaces() {
  await verifyDemoRuntime()
  const root = await writeFolder()
  const projects = listOf(await api('/projects'), 'projects')
  const project =
    projects.find((item) => item.workingDir === root) ??
    (await api('/projects', { name: 'Claude Code surfaces', workingDir: root }))
  const sessions = listOf(await api('/sessions'), 'sessions')
  const session =
    sessions.find((item) => item.title === TITLE && item.projectId === project.id) ??
    (await api('/sessions', { title: TITLE, projectId: project.id }))
  // The composer is off until a provider is set: the isolated placeholder connection, never called.
  await seedAgentCommand({ sessionId: session.id })
  const id = encodeURIComponent(`project:${MCP_NAME}`)
  // Made afresh, so a changed fixture script or path is what the runtime starts.
  await api(`/store/mcp-server/${id}/remove`, { scope: 'project', projectId: project.id }).catch(
    () => {},
  )
  await api('/store/create/mcp-server', {
    scope: 'project',
    projectId: project.id,
    values: {
      name: MCP_NAME,
      description: 'Release prompts',
      transport: 'stdio',
      command: `bun ${JSON.stringify(path.join(repoRoot, 'scripts/screenshots/mcp-prompts-server.mjs'))}`,
    },
  })
  // A menu reads the prompts of a live connection: connect it the way the Store's own test does.
  const test = await api(`/store/mcp-server/${id}/action`, {
    scope: 'project',
    projectId: project.id,
    action: 'test',
  })
  if (!test.ok) throw new Error(`The fixture MCP server did not connect: ${test.message}`)
  return { projectId: project.id, sessionId: session.id }
}

const input = (page) => page.getByRole('combobox', { name: 'Message', exact: true }).last()

/** The fixture conversation, open with its composer showing. */
export async function openSurfacesChat(page, ids) {
  await page.goto(`${uiOrigin}/#/project/${ids.projectId}/${ids.sessionId}`)
  await openConversation(page, TITLE)
  await expect(input(page)).toBeEnabled()
  // An earlier scenario's typed text is a draft the conversation keeps.
  await input(page).fill('')
}

export async function composeComposerSurfaces(page, scenario) {
  const ids = await seedComposerSurfaces()
  await openSurfacesChat(page, ids)
  if (scenario === 'status-line') {
    await page.getByRole('group', { name: 'Status', exact: true }).getByText('PR #42').waitFor()
  } else if (scenario === 'mcp-prompts') {
    await input(page).fill('/mcp__release')
    await page.getByRole('option', { name: /mcp__release__summarize_changes/ }).waitFor()
  } else if (scenario === 'plugin-waiting') {
    await input(page).fill(`/${PLUGIN}`)
    await page.getByRole('option', { name: `${PLUGIN} is waiting for your OK` }).waitFor()
  }
}

export async function verifyComposerSurfaces(page, scenario) {
  if (scenario === 'status-line') {
    const status = page.getByRole('group', { name: 'Status', exact: true })
    // Each printed line is a row of its own, under the message box.
    const rows = status.locator('[data-status-source="statusLine"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('main')
    await expect(rows.nth(0)).toContainText('3 changed')
    await expect(rows.nth(1)).toContainText('12 passing')
    // A script's green and red are drawn as the app's own success and error tones, never raw ANSI.
    await expect(rows.nth(1).locator('[data-tone="success"]')).toContainText('12 passing')
    await expect(rows.nth(1).locator('[data-tone="danger"]')).toContainText('1 failing')
    // An OSC 8 link is a real link that opens outside the app.
    await expect(status.getByRole('link', { name: 'PR #42' })).toHaveAttribute(
      'href',
      'https://example.com/release-studio/pull/42',
    )
    const box = await input(page).boundingBox()
    const area = await status.boundingBox()
    expect(area.y).toBeGreaterThan(box.y)
  } else if (scenario === 'mcp-prompts') {
    // Both prompts of the connected server, typed as Claude Code types them, with their own text.
    for (const [name, text] of [
      ['mcp__release__summarize_changes', 'Summarize what changed since the last release tag'],
      ['mcp__release__write_release_notes', 'Draft release notes'],
    ]) {
      const row = page.getByRole('option', { name: new RegExp(name) })
      await expect(row).toBeVisible()
      await expect(row).toContainText(text)
    }
  } else if (scenario === 'plugin-waiting') {
    const row = page.getByRole('option', { name: `${PLUGIN} is waiting for your OK` })
    await expect(row).toBeVisible()
    // It stands for the plugin, not for a command that would do nothing.
    await expect(page.getByRole('option', { name: /ship/ })).toHaveCount(0)
  }
}
