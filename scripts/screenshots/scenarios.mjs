export const button = (page, name) => page.getByRole('button', { name, exact: true })

export async function openTool(page, title) {
  await button(page, 'All tools').click()
  await page.getByText(title, { exact: true }).last().click()
  // Opening a workbench creates the left group; give the feature the whole workspace.
  const maximize = button(page, 'Maximize panel')
  if (await maximize.count()) await maximize.first().click()
}

async function editor(page) {
  await button(page, 'Files').click()
  const sourceFolder = page.getByRole('treeitem').filter({ hasText: /^src$/ })
  if ((await sourceFolder.getAttribute('aria-expanded')) !== 'true') await sourceFolder.click()
  await page
    .getByRole('treeitem')
    .filter({ hasText: /^release\.ts$/ })
    .dblclick()
  await page.locator('.monaco-editor').waitFor({ state: 'visible' })
  await button(page, 'Files').click()
  await button(page, 'Terminal').click()
  const terminalTab = page.getByRole('tab', { name: 'Terminal', exact: true })
  const fileTab = page.getByRole('tab', { name: 'release.ts', exact: true })
  // Reorder within the main column. Files and terminals share its full height.
  await terminalTab.dragTo(fileTab, { targetPosition: { x: 8, y: 12 } })
  if (
    await page.locator('[aria-label="Resize editor panes"][aria-orientation="horizontal"]').count()
  )
    throw new Error('The workspace must not stack editor panels.')
  await terminalTab.click({ button: 'right' })
  if (await page.getByRole('menuitem', { name: /^Split (Down|Right)/ }).count())
    throw new Error('The workspace must not offer arbitrary panel splits.')
  await page.keyboard.press('Escape')
  const vertical = page.locator(
    '[role="separator"][aria-label="Resize editor panes"][aria-orientation="vertical"]',
  )
  await vertical.press('ArrowRight')
  await terminalTab.click()
  const input = page.getByRole('textbox', { name: 'Terminal input' })
  await input.fill('clear; bun test src/release.test.ts')
  await input.press('Enter')
  await page
    .getByText(/2 pass/)
    .first()
    .waitFor()
}

export async function compose(page, scenario) {
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
    return (await import('./motion-workbench.mjs')).composeMotion(page, scenario)
  if (scenario === 'session-window-drag')
    return (await import('./session-drag.mjs')).composeSessionDrag(page)
  if (['trading', 'system-overview', 'kubernetes'].includes(scenario))
    return (await import('./platform-views.mjs')).composePlatformViews(page, scenario)
  if (['game-2048', 'chess', 'checkers', 'battleship', 'tic-tac-toe'].includes(scenario))
    return (await import('./game-workbenches.mjs')).composeGame(page, scenario)
  if (['code-graph', 'git', 'learning'].includes(scenario))
    return (await import('./developer-workbenches.mjs')).composeDeveloper(page, scenario)
  if (['external-terminal'].includes(scenario))
    return (await import('./external-workbench.mjs')).composeExternal(page, scenario)
  if (['api-client', 'documents', 'reader'].includes(scenario)) {
    return (await import('./content-workbenches.mjs')).composeContent(page, scenario)
  }
  if (scenario === 'participants') {
    await button(page, 'Chat history').click()
    await page.locator('[data-session-row]').first().waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Release checklist', exact: true }).waitFor()
    await button(page, 'Add participant').click()
    await page.getByRole('menu').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: 'Release checklist', exact: true }).click()
  } else if (scenario === 'agent') {
    await button(page, 'Settings').click()
    await button(page, 'Agents').click()
    await button(page, 'Open Backend').click()
    await button(page, 'Maximize panel').first().click()
    await page.getByText('Preloaded skills', { exact: true }).waitFor()
    await page.locator('[data-ui-scroll-container]').evaluateAll((elements) => {
      for (const element of elements) {
        if (element.clientHeight && element.scrollHeight > element.clientHeight) {
          element.scrollTop = element.scrollHeight
        }
      }
    })
  } else if (scenario === 'resume' || scenario === 'resume-library') {
    await openTool(page, 'Resumes')
    await page.getByText('Product engineer — demo', { exact: true }).waitFor()
    if (scenario === 'resume') {
      await page.getByText('Product engineer — demo', { exact: true }).click()
      await page.getByText('Loading pages…', { exact: true }).waitFor({ state: 'hidden' })
      await page.getByRole('document', { name: 'Page 1', exact: true }).waitFor()
      await page
        .getByRole('region', { name: 'Resume PDF preview', exact: true })
        .locator('canvas')
        .waitFor()
    }
  } else if (scenario === 'catalog') {
    await button(page, 'All tools').click()
    await page.getByText('Manage plugins…', { exact: true }).waitFor()
  } else if (scenario === 'models') {
    await page
      .getByRole('button', { name: /Choose a model and connect a provider|^Model:/ })
      .click()
    await page.getByText('Add provider', { exact: true }).waitFor()
    await page.getByRole('dialog').getByText('OpenAI', { exact: true }).first().click()
    await page.getByText('API Key(s) (manual)', { exact: true }).waitFor()
  } else if (scenario === 'palette') {
    await page.keyboard.press('F1')
    await page.getByRole('dialog').getByRole('combobox').fill('terminal')
  } else if (scenario === 'database') {
    await openTool(page, 'Database')
    await button(page, 'New query console for Release Studio').click()
    await page.locator('.monaco-editor').waitFor({ state: 'visible' })
    await page.locator('.monaco-editor').click({ position: { x: 150, y: 30 } })
    await page.keyboard.press('Meta+A')
    await page.keyboard.insertText('SELECT title, owner, status\nFROM release_checks\nORDER BY id;')
    await button(page, 'Run').click()
    await page.getByText('Write release notes', { exact: true }).waitFor()
  } else if (scenario === 'answer-board') {
    await openTool(page, 'Project Space')
    await page.getByRole('button', { name: /Fit everything/ }).click()
  } else if (scenario === 'containers') {
    await openTool(page, 'DevOps')
    await page.getByText('Containers', { exact: true }).first().click()
    await page.getByPlaceholder('Filter containers…').fill('localix-capture-preview')
    await page.getByText('localix-capture-preview', { exact: true }).dblclick()
    await page
      .getByText(/Configuration complete; ready for start up/)
      .first()
      .waitFor()
  } else if (scenario === 'queued' || scenario === 'question') {
    await button(page, 'Answer').waitFor()
    if (scenario === 'question') await button(page, 'Answer').click()
  } else if (scenario === 'terminal-error') {
    await button(page, 'Terminal').click()
    await button(page, 'Maximize panel').first().click()
    const input = page.getByRole('textbox', { name: 'Terminal input' })
    await input.fill('printf "Error: release configuration is missing\\n"; exit 17')
    await input.press('Enter')
    await page.locator('[data-slot="terminal-pane"][data-terminal-exited="true"]').waitFor()
  } else if (scenario === 'editor' || scenario === 'composer-context') {
    await editor(page)
    if (scenario === 'composer-context')
      await page.getByRole('button', { name: /^Review \d+ included context items?$/ }).click()
  } else {
    throw new Error(`No composition for ${scenario}`)
  }
}
