import { expect } from '@playwright/test'

/** Sidebar gestures link a conversation; no native availability is simulated. */
export async function composeSessionDrag(page) {
  const rows = page.locator('[data-session-row]')
  await page.getByRole('button', { name: 'Chat history', exact: true }).click()
  await expect(rows.first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Release checklist', exact: true })).toBeVisible()
  const draggable = rows.first().locator('..')
  await draggable.hover({ position: { x: 52, y: 16 } })
  const source = await draggable.boundingBox()
  if (!source) throw new Error('The fixture conversation row is not laid out')
  await page.mouse.move(source.x + 52, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width + 32, source.y + source.height / 2, { steps: 8 })
  const composer = page.locator('[data-agent-link-drop-target]:visible').first()
  const box = await composer.boundingBox()
  if (!box) throw new Error('The message composer is not laid out')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2)
  await expect(composer).toHaveAttribute('data-drop-active', 'true')
}

export async function verifySessionDrag(page) {
  await expect(page.locator('html')).toHaveAttribute('data-localix-agent-link-drag', 'session')
  await expect(page.locator('[data-workspace-transfer-targets]')).toHaveCount(0)
  const composer = page.locator('[data-agent-link-drop-target]:visible').first()
  await expect(composer).toHaveAttribute('data-drop-active', 'true')
  await expect(composer.locator('[data-agent-link-drop-hint]')).toBeVisible()
}
