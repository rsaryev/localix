import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { composeAgentCommand, seedAgentCommand } from './agent-command.mjs'
import { fixtureFile, uiOrigin, captureRoot } from './runtime.mjs'

for (const theme of ['dark', 'light']) {
  for (const width of [900, 1600]) {
    test(`agents/command-layout/${theme}-${width}`, async ({ page }) => {
      const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
      await seedAgentCommand(fixture)
      await page.setViewportSize({ width, height: 1000 })
      await page.addInitScript((value) => localStorage.setItem('sandbox_theme', value), theme)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
      await composeAgentCommand(page)
      const input = page.getByRole('combobox', { name: 'Message', exact: true }).last()
      await input.blur()
      await expect(page.getByRole('listbox', { name: 'Command arguments' })).toHaveCount(0)
      await input.focus()
      await expect(page.getByRole('listbox', { name: 'Command arguments' })).toHaveCount(1)
      expect(errors).toEqual([])
      const directory = path.join(captureRoot, 'layout-review')
      await fs.mkdir(directory, { recursive: true })
      await page.screenshot({
        path: path.join(directory, `agent-command-${theme}-${width}.png`),
        animations: 'disabled',
      })
    })
  }
}
