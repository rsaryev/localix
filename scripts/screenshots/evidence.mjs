import { expect } from '@playwright/test'

export async function verifyEvidence(page, scenario) {
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
  if (scenario === 'agent') {
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
  } else if (scenario === 'palette') {
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('split')
  } else if (scenario === 'editor') {
    await expect(page.getByRole('textbox', { name: 'Terminal input' })).toBeVisible()
    await expect(page.getByText(/2 pass/).first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'release.ts', exact: true })).toBeVisible()
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
