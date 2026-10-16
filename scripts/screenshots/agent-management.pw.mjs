import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { composeAgentManagement, seedAgentManagement } from './agent-management.mjs'
import { fixtureFile, uiOrigin, captureRoot } from './runtime.mjs'

// Layout checks stay optional with product captures; one canonical shot belongs to the guide.
for (const theme of ['dark', 'light']) {
  for (const width of [900, 1600]) {
    test(`agents/profile-from-chat/${theme}-${width}`, async ({ page }) => {
      const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
      await seedAgentManagement(fixture)
      await page.setViewportSize({ width, height: 1000 })
      await page.addInitScript((value) => localStorage.setItem('sandbox_theme', value), theme)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
      await composeAgentManagement(page)
      await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeEnabled()
      expect(errors).toEqual([])
      const directory = path.join(captureRoot, 'layout-review')
      await fs.mkdir(directory, { recursive: true })
      await page.screenshot({
        path: path.join(directory, `agent-form-${theme}-${width}.png`),
        animations: 'disabled',
      })
    })
  }
}
