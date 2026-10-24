import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { api } from './runtime.mjs'
import { button, openTool } from './scenarios.mjs'

const requestName = 'Release readiness'
const bookName = 'A practical release review'
const statusUrl = 'http://127.0.0.1:5160/release-status.json'

export async function seedContent(fixture) {
  const scoped = (route) => `${route}?sessionId=${encodeURIComponent(fixture.sessionId)}`
  await fs.writeFile(
    path.join(fixture.root, 'release-status.json'),
    `${JSON.stringify(
      {
        release: 'Workspace update',
        status: 'ready_for_review',
        checks: { desktop: 'passed', mobile: 'passed', accessibility: 'passed' },
        tasks: { completed: 3, remaining: 1 },
      },
      null,
      2,
    )}\n`,
  )
  await fs.writeFile(
    path.join(fixture.root, 'release-checks.csv'),
    'Check,Owner,Status,Duration (ms)\nDesktop layout,Frontend,Passed,124\nMobile preview,Frontend,Passed,186\nKeyboard navigation,QA,Passed,92\nRelease notes,Team Lead,In review,0\nResponsive headings,Frontend,Passed,103\nImage loading,Frontend,Passed,147\nDialog dismissal,QA,Passed,82\nSearch filtering,QA,Passed,216\nCommand shortcuts,QA,Passed,94\nNavigation history,Frontend,Passed,132\nFocus restoration,QA,Passed,76\nEmpty states,Frontend,Passed,158\nError recovery,QA,Passed,205\nForm validation,QA,Passed,117\nColor contrast,Design,Passed,68\nReduced motion,Frontend,Passed,89\nDocumentation links,Team Lead,Passed,142\nRelease summary,Team Lead,In review,0\n',
  )
  await fs.writeFile(
    path.join(fixture.root, 'release-review.md'),
    `# ${bookName}\n\nA short field guide for reviewing a workspace update before publishing it.\n\n## Start with the outcome\n\nA release review begins with the change a person will notice. Open the shared workspace, choose the release conversation, and compare the implementation with the goal. Keep the source, preview, and checks close enough to move between them without losing context.\n\nThe review should answer three questions: does the interface communicate its purpose, can someone complete the intended task, and does the behavior remain reliable on a small screen? Record the answer as evidence rather than a general impression.\n\n## Review the interface\n\nCheck the desktop layout first. Follow the visual hierarchy from the title to the primary action. Read the labels aloud and remove words that do not help someone make a decision. A quiet interface leaves room for the work itself.\n\nThen open the mobile preview. Verify that content stays within the viewport, controls remain reachable, and the important result is visible without horizontal scrolling. Test keyboard navigation and inspect the focus indicator.\n\n## Keep a useful record\n\nName each check for the result it proves. Attach a screenshot when it makes the review easier to understand, and keep the underlying test result alongside it. A picture of an empty panel does not prove a feature works.\n\nWhen all checks pass, summarize the release in a few concrete sentences. Leave unfinished work on the board with an owner and a next action.\n`,
  )
  // Native API routes instantiate one mini app backend: this is global within the
  // verified disposable database, not a change to the person's workspace.
  await api('/mini-apps/config', { name: 'api', values: { ALLOW_PRIVATE_NETWORK: true } })
  const requests = await api(scoped('/api/requests'))
  if (!requests.requests.some((request) => request.name === requestName)) {
    await api(scoped('/api/requests'), {
      name: requestName,
      method: 'GET',
      url: statusUrl,
      headers: [{ name: 'Accept', value: 'application/json' }],
      query: [],
    })
  }
  await api(
    `/reader/document?sessionId=${encodeURIComponent(fixture.sessionId)}&path=${encodeURIComponent(path.join(fixture.root, 'release-review.md'))}`,
  )
}

export async function composeContent(page, scenario) {
  if (scenario === 'api-client') {
    // Served by the isolated fixture service, never intercepted in the browser.
    const response = await fetch(statusUrl)
    if (!response.ok || (await response.json()).status !== 'ready_for_review')
      throw new Error('Start the capture fixture HTTP service on port 5160 before API captures.')
    await openTool(page, 'API Client')
    await page.getByText(requestName, { exact: true }).first().click()
    await button(page, 'Send').click()
    await page.getByText('200 OK', { exact: true }).waitFor()
  } else if (scenario === 'documents') {
    await button(page, 'Files').click()
    await page
      .getByRole('treeitem')
      .filter({ hasText: /^release-checks\.csv$/ })
      .dblclick()
    const chooser = page.getByRole('button', { name: 'Table view', exact: true })
    if (await chooser.count()) await chooser.click()
    const maximize = button(page, 'Maximize panel')
    if (await maximize.count()) await maximize.first().click()
    if (await page.getByRole('treeitem').first().isVisible()) await button(page, 'Files').click()
    await page.getByText('Keyboard navigation', { exact: true }).waitFor()
  } else if (scenario === 'reader') {
    await openTool(page, 'Reader')
    await page.getByText(bookName, { exact: true }).first().click()
    await page.getByRole('treeitem').filter({ hasText: 'Start with the outcome' }).click()
    await page.getByRole('heading', { name: 'Start with the outcome', exact: true }).waitFor()
  } else throw new Error(`Unknown content workbench scenario: ${scenario}`)
}

export async function verifyContent(page, scenario) {
  if (scenario === 'api-client') {
    await expect(page.getByRole('textbox', { name: 'URL', exact: true })).toHaveValue(statusUrl)
    await expect(page.getByText('200 OK', { exact: true })).toBeVisible()
    await expect(page.getByText(/ready_for_review/).first()).toBeVisible()
    await expect(button(page, 'Send')).toBeEnabled()
  } else if (scenario === 'documents') {
    await expect(page.getByText('Keyboard navigation', { exact: true })).toBeVisible()
    await expect(page.getByText('Release notes', { exact: true })).toBeVisible()
    await expect(page.getByText('Release summary', { exact: true })).toBeVisible()
    await expect(page.getByText('In review', { exact: true }).first()).toBeVisible()
  } else if (scenario === 'reader') {
    await expect(
      page.getByRole('heading', { name: 'Start with the outcome', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/A release review begins with the change a person/)).toBeVisible()
    await expect(page.getByText(/Record the answer as evidence/)).toBeVisible()
  } else throw new Error(`Unknown content workbench scenario: ${scenario}`)
}
