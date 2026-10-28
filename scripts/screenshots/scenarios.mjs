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
  if (scenario === 'agent-command')
    return (await import('./agent-command.mjs')).composeAgentCommand(page)
  if (scenario === 'agent-management')
    return (await import('./agent-management.mjs')).composeAgentManagement(page)
  if (scenario === 'agent')
    return (await import('./agent-management.mjs')).composeAgentProfile(page)
  if (['kanban-board', 'kanban-conversation'].includes(scenario))
    return (await import('./kanban-workbenches.mjs')).composeKanban(page, scenario)
  if (scenario === 'visual-feedback')
    return (await import('./visual-feedback.mjs')).composeVisualFeedback(page)
  if (scenario === 'session-window-drag')
    return (await import('./session-drag.mjs')).composeSessionDrag(page)
  if (scenario === 'cloud-connection')
    return (await import('./cloud-connection.mjs')).composeCloudConnection(page)
  if (scenario === 'unfinished-reply')
    return (await import('./unfinished-reply.mjs')).composeUnfinishedReply(page)
  if (scenario === 'settings-strip')
    return (await import('./settings-strip.mjs')).composeSettingsStrip(page)
  if (scenario === 'tool-sections')
    return (await import('./tool-sections.mjs')).composeToolSections(page)
  if (scenario === 'agent-children')
    return (await import('./agent-children.mjs')).composeAgentChildren(page)
  if (['status-line', 'mcp-prompts', 'plugin-waiting'].includes(scenario))
    return (await import('./composer-surfaces.mjs')).composeComposerSurfaces(page, scenario)
  if (['for-your-work', 'for-your-work-all'].includes(scenario))
    return (await import('./recommendations.mjs')).composeRecommendations(page, scenario)
  if (scenario.startsWith('store'))
    return (await import('./store.mjs')).composeStore(page, scenario)
  if (['local-models-settings', 'semantic-search'].includes(scenario))
    return (await import('./local-models.mjs')).composeLocalModels(page, scenario)
  if (['trading', 'system-overview', 'kubernetes'].includes(scenario))
    return (await import('./platform-views.mjs')).composePlatformViews(page, scenario)
  if (
    ['game-2048', 'chess', 'checkers', 'battleship', 'tic-tac-toe', 'rock-paper-scissors'].includes(
      scenario,
    )
  )
    return (await import('./game-workbenches.mjs')).composeGame(page, scenario)
  if (['code-graph', 'git', 'learning'].includes(scenario))
    return (await import('./developer-workbenches.mjs')).composeDeveloper(page, scenario)
  if (['external-terminal'].includes(scenario))
    return (await import('./external-workbench.mjs')).composeExternal(page, scenario)
  if (['api-client', 'documents', 'reader'].includes(scenario)) {
    return (await import('./content-workbenches.mjs')).composeContent(page, scenario)
  }
  if (scenario === 'browser-preview') {
    await button(page, 'Browser').click()
    const address = page.getByRole('combobox', { name: 'Browser address', exact: true })
    await address.fill('http://127.0.0.1:5160')
    await address.press('Enter')
    const preview = page.frameLocator('iframe[title^="http://127.0.0.1:5160"]')
    await preview.getByRole('heading', { name: 'A clear path to the next release.' }).waitFor()
    await button(page, 'Just browse').click()
    await preview.getByRole('button', { name: 'Review release', exact: true }).click()
    await preview.getByText('Ready for review', { exact: true }).waitFor()
    if (await page.getByRole('region', { name: 'Session history', exact: true }).isVisible()) {
      await button(page, 'Chat history').focus()
      await page.keyboard.press('F1')
      await page.getByRole('dialog').getByRole('combobox').fill('Toggle sidebar')
      await page.getByRole('option', { name: /Toggle sidebar/ }).click()
    }
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
      .getByRole('button', { name: /Choose a model and connect a provider|^Choose model|^Model:/ })
      .click()
    await page.getByText('Add provider', { exact: true }).waitFor()
    // OpenAI leaves the list once a connection to it exists (the capture's placeholder is one).
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(OpenAI|Anthropic)$/ })
      .first()
      .click()
    await page
      .getByText(/API Key/)
      .first()
      .waitFor()
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
  } else if (scenario === 'diagram-board') {
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
  } else if (scenario === 'first-run') {
    await page.getByRole('region', { name: 'Workspace tips', exact: true }).waitFor()
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
