import { expect } from '@playwright/test'

// The editor's language-server completion, driven the way a person does it: open a TypeScript file,
// put the caret after `channel.` at the end of a line and ask for suggestions. Nothing is typed, so
// the file stays valid and unsaved-free. The list is the language server's answer for the type of
// `channel` (properties and methods); nothing is scripted. The server is installed on first use,
// so a capture home needs it seeded (see the README) or the network on the first run.
const FILE = 'assist.ts'
const SERVER_WAIT = { timeout: 60_000 }
// The members of `channel` in src/assist.ts: four properties and five methods.
const MEMBERS = [
  'name',
  'audience',
  'rolloutPercent',
  'paused',
  'publish',
  'pause',
  'resume',
  'rollBack',
  'describe',
]

export async function composeEditorCompletion(page) {
  const files = page.getByRole('button', { name: 'Files', exact: true })
  await files.click()
  const sourceFolder = page.getByRole('treeitem').filter({ hasText: /^src$/ })
  // The tree restores its open folders a moment after it appears, so click only while closed.
  await expect(async () => {
    if ((await sourceFolder.getAttribute('aria-expanded')) !== 'true') await sourceFolder.click()
    await expect(sourceFolder).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
  }).toPass()
  await page
    .getByRole('treeitem')
    .filter({ hasText: /^assist\.ts$/ })
    .dblclick()
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await files.click()
  // The language server has answered once its symbols reach the breadcrumb.
  const trail = page.getByRole('navigation', { name: 'Document symbols' })
  await expect(trail.getByRole('button', { name: /^Browse symbols in assist\.ts/ })).toBeVisible(
    SERVER_WAIT,
  )
  // Share the frame by its width: the editor gets more of a wide one, and at a narrow one (the
  // landing page's) the chat gets enough for the composer's chips not to be clipped.
  const divider = page.locator(
    '[role="separator"][aria-label="Resize editor panes"][aria-orientation="vertical"]',
  )
  await divider.focus()
  const wide = page.viewportSize().width >= 1400
  for (let i = 0; i < (wide ? 6 : 3); i++) await divider.press(wide ? 'ArrowRight' : 'ArrowLeft')
  const list = page.locator('.suggest-widget.visible')
  // Click the line `const text = channel.` and press End: the caret lands right after the dot.
  // The server may still be loading the project, so ask until it answers.
  const openList = async () => {
    await expect(async () => {
      // A pointer click at the line's own position: a locator click would also scroll the
      // editor's clipped container into view, which shifts the lines inside the frame.
      const line = page
        .locator('.monaco-editor .view-line')
        .filter({ hasText: /^const\s+text\s+=\s+channel\.$/ })
      const at = await line.boundingBox()
      await page.mouse.click(at.x + 20, at.y + at.height / 2)
      await page.keyboard.press('End')
      await expect(page.getByText(/^Ln \d+, Col \d+$/)).toHaveText('Ln 20, Col 22', {
        timeout: 1_000,
      })
    }).toPass(SERVER_WAIT)
    await expect(async () => {
      if (!(await list.isVisible())) await page.keyboard.press('Control+Space')
      await expect(list.getByText(MEMBERS.at(-1), { exact: true }).first()).toBeVisible({
        timeout: 1_000,
      })
    }).toPass(SERVER_WAIT)
  }
  await openList()
  // The composer's recommendation strip arrives when the marketplaces have answered, and the
  // runner hides it with a click just before the picture, which would close the list. Hide it
  // here, then bring the list back. On a fresh capture home it arrives late, so the wait is long;
  // the spec raises the test's own timeout to match.
  const hide = page.getByRole('button', { name: 'Hide until there are new recommendations' })
  await hide.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  if (await hide.isVisible()) {
    await hide.click()
    await expect(hide).toBeHidden()
    await openList()
  }
  // The file is shown from its first line, with no scope header overlapping it.
  await expect(page.locator('.monaco-editor .line-numbers').first()).toHaveText('1')
  await expect(list.getByText('rolloutPercent', { exact: true }).first()).toBeVisible()
}

export async function verifyEditorCompletion(page) {
  await expect(page.getByRole('tab', { name: FILE, exact: true })).toBeVisible()
  const list = page.locator('.suggest-widget.visible')
  for (const member of MEMBERS)
    await expect(list.getByText(member, { exact: true }).first()).toBeVisible()
  // The caret is at the end of the statement's first line, and the breadcrumb names its symbol.
  await expect(page.getByText(/^Ln \d+, Col \d+$/)).toHaveText('Ln 20, Col 22')
  const trail = page.getByRole('navigation', { name: 'Document symbols' })
  await expect(trail.getByRole('button', { name: 'Go to text', exact: true })).toBeVisible()
  await expect(page.locator('.view-line', { hasText: 'channel.' }).first()).toBeVisible()
  await expect(page.getByText(/^Installing /)).toHaveCount(0)
  await expect(page.getByText(/not installed|offline$/)).toHaveCount(0)
}
