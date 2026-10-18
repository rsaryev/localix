import { expect } from '@playwright/test'
import { button } from './scenarios.mjs'

const NOTE = 'Shorten the headline to one line'
const EDITED = `${NOTE}; keep the verb first`

const preview = (page) => page.frameLocator('iframe[title^="http://127.0.0.1:5160"]')
const headline = (page) =>
  preview(page).getByRole('heading', { name: 'A clear path to the next release.' })

/**
 * A comment's life in the live preview, with real pointer actions: pick the headline, attach a
 * note, then click the same headline again — the page opens that comment, numbered, to edit.
 */
export async function composeVisualFeedback(page) {
  await button(page, 'Browser').click()
  const address = page.getByRole('combobox', { name: 'Browser address', exact: true })
  await address.fill('http://127.0.0.1:5160')
  await address.press('Enter')
  await headline(page).waitFor()
  await button(page, 'Just browse').click()

  await button(page, 'Visual Feedback').click()
  await expect(button(page, 'Visual Feedback')).toHaveAttribute('aria-pressed', 'true')
  await headline(page).click()
  const card = page.getByRole('form', { name: /^Comment on / })
  await card.getByRole('textbox', { name: 'Comment' }).fill(NOTE)
  // Enabled once the page has rendered the element's screenshot.
  await card.getByRole('button', { name: 'Attach feedback' }).click()
  await card.waitFor({ state: 'detached' })
  // Staged as one context item in the composer. The composer's task strip can arrive while the
  // button is clicked and move it, so the list is opened until it shows.
  const item = page.getByRole('button', { name: /^Show details of Preview: / })
  await expect(async () => {
    if (!(await item.first().isVisible()))
      await page.locator('button', { hasText: /^Context/ }).click()
    await expect(item).toHaveCount(1, { timeout: 1000 })
  }).toPass()
  await page.keyboard.press('Escape')

  await headline(page).click()
  const edit = page.getByRole('form', { name: /^Edit comment on / })
  await edit.waitFor()
  await edit.getByRole('textbox', { name: 'Comment' }).fill(EDITED)
}

export async function verifyVisualFeedback(page) {
  const edit = page.getByRole('form', { name: /^Edit comment on / })
  await expect(edit).toBeVisible()
  await expect(edit).toContainText('#1')
  await expect(edit.getByRole('textbox', { name: 'Comment' })).toHaveValue(EDITED)
  await expect(edit.getByRole('button', { name: 'Delete comment' })).toBeVisible()
  await expect(edit.getByRole('button', { name: 'Save' })).toBeEnabled()
  // The reopened card edits the comment rather than starting a second one.
  await expect(page.getByRole('form', { name: /^Comment on / })).toHaveCount(0)
}
