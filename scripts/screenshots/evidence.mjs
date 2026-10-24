import { expect } from '@playwright/test'

export async function verifyEvidence(page, scenario) {
  if (scenario.startsWith('island-'))
    return (await import('./agent-island.mjs')).verifyIsland(page, scenario)
  if (scenario === 'agent-command')
    return (await import('./agent-command.mjs')).verifyAgentCommand(page)
  if (scenario === 'agent-management')
    return (await import('./agent-management.mjs')).verifyAgentManagement(page)
  if (['kanban-board', 'kanban-conversation'].includes(scenario))
    return (await import('./kanban-workbenches.mjs')).verifyKanban(page, scenario)
  if (scenario === 'visual-feedback')
    return (await import('./visual-feedback.mjs')).verifyVisualFeedback(page)
  if (scenario === 'session-window-drag')
    return (await import('./session-drag.mjs')).verifySessionDrag(page)
  if (scenario === 'party-route') return (await import('./party-route.mjs')).verifyPartyRoute(page)
  if (scenario === 'model-command')
    return (await import('./model-command.mjs')).verifyModelCommand(page)
  if (scenario === 'cloud-connection')
    return (await import('./cloud-connection.mjs')).verifyCloudConnection(page)
  if (scenario === 'unfinished-reply')
    return (await import('./unfinished-reply.mjs')).verifyUnfinishedReply(page)
  if (scenario === 'store' || scenario === 'store-listing' || scenario === 'store-commands')
    return (await import('./store.mjs')).verifyStore(page, scenario)
  if (scenario === 'codemode-card')
    return (await import('./codemode-card.mjs')).verifyCodemodeCard(page)
  if (['local-models-settings', 'semantic-search'].includes(scenario))
    return (await import('./local-models.mjs')).verifyLocalModels(page, scenario)
  if (['trading', 'system-overview', 'kubernetes'].includes(scenario))
    return (await import('./platform-views.mjs')).verifyPlatformViews(page, scenario)
  if (
    ['game-2048', 'chess', 'checkers', 'battleship', 'tic-tac-toe', 'rock-paper-scissors'].includes(
      scenario,
    )
  )
    return (await import('./game-workbenches.mjs')).verifyGame(page, scenario)
  if (['code-graph', 'git', 'learning'].includes(scenario))
    return (await import('./developer-workbenches.mjs')).verifyDeveloper(page, scenario)
  if (['external-terminal'].includes(scenario))
    return (await import('./external-workbench.mjs')).verifyExternal(page, scenario)
  if (['api-client', 'documents', 'reader'].includes(scenario)) {
    return (await import('./content-workbenches.mjs')).verifyContent(page, scenario)
  }
  if (scenario === 'first-run') {
    await expect(page.getByRole('region', { name: 'Workspace tips', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Session history', exact: true })).toBeHidden()
    await expect(page.getByRole('combobox', { name: 'Browser address', exact: true })).toBeHidden()
    await expect(page.locator('[data-slot="terminal-pane"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeHidden()
    return
  }
  if (scenario === 'browser-preview') {
    await expect(page.getByRole('region', { name: 'Session history', exact: true })).toBeHidden()
    const preview = page.frameLocator('iframe[title^="http://127.0.0.1:5160"]')
    await expect(preview.getByText('Ready for review', { exact: true })).toBeVisible()
    await expect(preview.getByRole('checkbox', { name: 'Review the changes' })).toBeChecked()
    await expect(preview.getByRole('checkbox', { name: 'Check the mobile layout' })).toBeChecked()
    await expect(preview.getByRole('checkbox', { name: 'Publish release notes' })).not.toBeChecked()
    await expect(
      page.getByRole('group', { name: 'Conversation participants', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Visual Feedback', exact: true })).toBeVisible()
  } else if (scenario === 'participants') {
    const roster = page.getByRole('group', { name: 'Conversation participants', exact: true })
    await expect(roster.locator('[data-slot="participant-chip"]')).toHaveCount(3)
    for (const handle of ['localix', 'frontend', 'qa'])
      await expect(roster.getByTitle(`Show @${handle}'s model`, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Release checklist', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Both release states pass the checks/)).toBeVisible()
    await expect(roster.getByRole('button', { name: /^Usage for / })).toHaveCount(0)
    const total = page
      .getByRole('group', { name: 'Conversation actions', exact: true })
      .getByRole('button', { name: 'Total session usage', exact: true })
    await expect(total).toHaveText('')
    await expect(
      roster.getByRole('button', { name: 'Total session usage', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Voice input', exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Choose models for 3 participants', exact: true }),
    ).toBeVisible()
    const mode = page.getByRole('button', { name: /^Permission mode:/ })
    await expect(mode).toHaveAttribute('data-slot', 'composer-chip')
    await expect(mode.locator('.lucide-chevron-down')).toBeVisible()
    // The first seat is selected by default; clicking another selects it without a mention.
    const localixChip = roster.getByTitle("Show @localix's model", { exact: true })
    const frontendChip = roster.getByTitle("Show @frontend's model", { exact: true })
    await expect(localixChip).toHaveAttribute('aria-pressed', 'true')
    await frontendChip.click()
    await expect(frontendChip).toHaveAttribute('aria-pressed', 'true')
    await expect(localixChip).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('textarea').first()).not.toHaveValue(/@frontend/)
    await total.hover()
    await expect(page.getByText('Session total', { exact: true })).toBeVisible()
    await expect(page.getByText('9,900', { exact: true })).toBeVisible()
    await expect(page.getByText('By participant', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('progressbar', { name: 'Frontend context usage', exact: true }),
    ).toBeVisible()
    await page.getByRole('heading', { name: 'Release checklist', exact: true }).hover()
    await expect(page.getByText('Session total', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByText('Add participant', { exact: true })).toHaveCount(0)
  } else if (scenario === 'agent') {
    await expect(page.getByText('Preloaded skills', { exact: true })).toBeVisible()
    await expect(page.getByText('Max turns', { exact: true })).toBeVisible()
    await expect(page.getByText('Save changes', { exact: true })).toBeDisabled()
  } else if (scenario === 'resume') {
    const document = page.getByRole('document', { name: 'Page 1', exact: true })
    await expect(document).toContainText('Alex Morgan')
    await expect(document).toContainText('Example Studio')
    await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue(
      'Alex Morgan',
    )
  } else if (scenario === 'resume-library') {
    await expect(page.getByRole('button', { name: 'Open Product engineer — demo' })).toBeVisible()
  } else if (scenario === 'database') {
    await expect(page.getByText('Write release notes', { exact: true })).toBeVisible()
    await expect(page.getByText('Frontend', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('4 rows', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Query failed', { exact: true })).toHaveCount(0)
  } else if (scenario === 'answer-board') {
    await expect(page.getByText('Review the interface', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Checks', exact: true }).click()
    await expect(
      page.getByText('Both pending and ready states are covered.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('tab', { name: 'Interface', exact: true }).click()
    await page.waitForTimeout(450)
    await page.mouse.click(1450, 850)
    await page.getByRole('button', { name: 'Fit everything', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Project files', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await expect(
      page.getByRole('heading', { name: 'Release summary', exact: true }),
    ).toBeInViewport({ ratio: 1 })
  } else if (scenario === 'diagram-board') {
    // Marks are drawn, not printed: the bold heading and the ticked tasks are real elements.
    await expect(page.locator('strong', { hasText: 'Before shipping' })).toBeVisible()
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(2)
    await expect(page.getByText('**', { exact: false })).toHaveCount(0)
    await expect(page.locator('.space-font-hand', { hasText: 'Keep the release' })).toBeVisible()
    // Captions sit beside their line, readable, never cut by a card.
    // The Mermaid flowchart is drawn natively: its steps are the board's text, not a picture.
    await expect(page.getByRole('img', { name: /^Release pipeline: 6 steps/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /^Next quarter: Offline mode/ })).toBeVisible()
    for (const caption of ['scope', 'passes', 'fails', 'retry'])
      await expect(page.locator('[data-canvas-edge-label]', { hasText: caption })).toBeInViewport({
        ratio: 0.99,
      })
  } else if (scenario === 'models') {
    await expect(page.getByText('API Key(s) (manual)', { exact: true })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveValue('')
  } else if (scenario === 'catalog') {
    await expect(page.getByText('Database', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('Manage plugins…', { exact: true })).toBeVisible()
    const rows = await page
      .locator('[role="menu"] [data-slot="menu-leading-icon"]')
      .evaluateAll((icons) =>
        icons.map((icon) => {
          const mark = icon.getBoundingClientRect()
          const label = icon.nextElementSibling.getBoundingClientRect()
          return { gap: label.left - mark.right, position: getComputedStyle(icon).position }
        }),
      )
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) {
      expect(row.gap).toBeGreaterThanOrEqual(4)
      expect(row.position).toBe('static')
    }
  } else if (scenario === 'palette') {
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('terminal')
  } else if (scenario === 'terminal-error') {
    const exited = page.locator('[data-slot="terminal-pane"][data-terminal-exited="true"]')
    const terminalTab = page.getByRole('tab', { name: /^Terminal/ })
    await expect(exited).toBeVisible()
    await expect(page.locator('.xterm-screen')).toContainText(
      'Error: release configuration is missing',
    )
    await expect(page.getByRole('status').filter({ hasText: /Process exited/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Restart terminal', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close terminal', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Split\b/ })).toHaveCount(0)
    // The workspace poll must not remove the evidence after the next registry snapshot.
    await page.waitForTimeout(21_000)
    await expect(exited).toBeVisible()
    await expect(page.locator('.xterm-screen')).toContainText(
      'Error: release configuration is missing',
    )
    // Reopen after the server's 30-second final-screen archive has expired.
    await page.waitForTimeout(11_000)
    await terminalTab.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
    await page.keyboard.press('Meta+Shift+T')
    await expect(exited).toBeVisible()
    await expect(page.locator('.xterm-screen')).toContainText(
      'Error: release configuration is missing',
    )
    await terminalTab.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /^Split\b/ })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Restart terminal', exact: true }).click()
    await expect(exited).toHaveCount(0)
    const input = page.getByRole('textbox', { name: 'Terminal input' })
    await input.fill('exit')
    await input.press('Enter')
    await expect(page.getByRole('tab', { name: /^Terminal/ })).toHaveCount(0)
    // The capture shows retained output and the tab menu where Restart now lives.
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await input.fill('printf "Error: release configuration is missing\\n"; exit 17')
    await input.press('Enter')
    await expect(exited).toBeVisible()
    await page.getByRole('button', { name: 'Maximize panel', exact: true }).first().click()
    await terminalTab.click({ button: 'right' })
    await expect(
      page.getByRole('menuitem', { name: 'Restart terminal', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Split\b/ })).toHaveCount(0)
  } else if (scenario === 'editor' || scenario === 'composer-context') {
    await expect(page.getByRole('textbox', { name: 'Terminal input' })).toBeVisible()
    await expect(page.getByText(/2 pass/).first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'release.ts', exact: true })).toBeVisible()
    if (scenario === 'composer-context') {
      const context = page.getByRole('list', { name: 'Context', exact: true })
      const rows = context.getByRole('listitem')
      await expect(rows).toHaveCount(2)
      await expect(context.getByText('release.ts', { exact: true })).toBeVisible()
      await expect(rows.filter({ hasText: /terminal/i })).toHaveCount(1)
      for (const row of await rows.all()) {
        await expect(row.getByText('Automatic · open tab', { exact: true })).toBeVisible()
        await expect(row.getByText(/· \d+(?:\.\d+)?k? chars/)).toBeVisible()
      }
    }
  } else if (scenario === 'containers') {
    const panel = page.getByRole('tabpanel', { name: 'localix-capture-preview', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('nginx:alpine')
    await expect(panel).toContainText('running')
  }
  await expect(
    page
      .getByText(/^(Loading pages…|Loading models…|Opening editor|Rendering conversation)$/)
      .first(),
  ).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0)
}
