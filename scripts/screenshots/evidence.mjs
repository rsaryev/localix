import { expect } from '@playwright/test'

export async function verifyEvidence(page, scenario) {
  if (
    [
      'motion-editor',
      'motion-library',
      'motion-projects',
      'motion-empty',
      'motion-template-preview',
      'motion-template-return',
      'motion-dark-hook',
      'motion-product-reveal',
    ].includes(scenario)
  )
    return (await import('./motion-workbench.mjs')).verifyMotion(page, scenario)
  if (scenario === 'session-window-drag')
    return (await import('./session-drag.mjs')).verifySessionDrag(page)
  if (['trading', 'system-overview', 'kubernetes'].includes(scenario))
    return (await import('./platform-views.mjs')).verifyPlatformViews(page, scenario)
  if (['game-2048', 'chess', 'checkers', 'battleship', 'tic-tac-toe'].includes(scenario))
    return (await import('./game-workbenches.mjs')).verifyGame(page, scenario)
  if (['code-graph', 'git', 'learning'].includes(scenario))
    return (await import('./developer-workbenches.mjs')).verifyDeveloper(page, scenario)
  if (['external-terminal'].includes(scenario))
    return (await import('./external-workbench.mjs')).verifyExternal(page, scenario)
  if (['api-client', 'documents', 'reader'].includes(scenario)) {
    return (await import('./content-workbenches.mjs')).verifyContent(page, scenario)
  }
  if (scenario === 'participants') {
    const roster = page.getByRole('group', { name: 'Conversation participants', exact: true })
    await expect(roster.locator('[data-slot="participant-chip"]')).toHaveCount(3)
    for (const handle of ['lead', 'frontend', 'qa'])
      await expect(roster.getByTitle(`Mention @${handle}`, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Release checklist', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Both release states pass the checks/)).toBeVisible()
    await expect(roster.getByRole('button', { name: /^Usage for / })).toHaveCount(3)
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
    const agentUsage = roster.getByRole('button', { name: 'Usage for Frontend', exact: true })
    await agentUsage.hover()
    await expect(page.getByText('Frontend · Session usage', { exact: true })).toBeVisible()
    await expect(page.getByText('50%', { exact: true })).toBeVisible()
    await expect(page.getByText('6,000', { exact: true })).toBeVisible()
    await expect(page.getByText('3,300', { exact: true })).toBeVisible()
    await total.hover()
    await expect(page.getByText('Session total', { exact: true })).toBeVisible()
    await expect(page.getByText('9,900', { exact: true })).toBeVisible()
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
  } else if (scenario === 'question') {
    await expect(page.getByText('Shared workspace', { exact: true })).toBeVisible()
    await expect(page.getByText('Team collaboration', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Send answer/ })).toBeEnabled()
  } else if (scenario === 'queued') {
    await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeVisible()
    await expect(
      page.getByText('Which change should lead the release notes?', { exact: true }).first(),
    ).toBeVisible()
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
