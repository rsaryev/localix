import { expect } from '@playwright/test'
import { api } from './runtime.mjs'

// `conversations/apply-model-to-all`: the seeded room disagrees — the main agent on a stronger
// model and level than the two specialists — so the always-offered "All agents" row reads as mixed
// and not chosen. Model ids only; no connection or credential is stated, and nothing is sent to a
// provider.
const ROUTES = [
  ['localix', 'openai/gpt-5.5', 'high'],
  ['frontend', 'anthropic/claude-haiku-4-5', 'low'],
  ['qa', 'anthropic/claude-haiku-4-5', 'low'],
]

export async function seedPartyRoutes(sessionId, demoAgents) {
  await api(
    `/sessions/${sessionId}`,
    {
      routes: ROUTES.map(([handle, modelId, reasoningEffort]) => ({
        agentId: demoAgents[handle],
        modelId,
        reasoningEffort,
      })),
    },
    'PATCH',
  )
}

const dialog = (page) => page.getByRole('dialog')
const allAgents = (page) =>
  dialog(page).getByRole('button', { name: 'Configure all agents', exact: true })

export async function composePartyRoute(page) {
  await page.getByRole('heading', { name: 'Release checklist', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Choose models for 3 participants', exact: true }).click()
  await allAgents(page).waitFor({ state: 'visible' })
  await allAgents(page).click()
}

export async function verifyPartyRoute(page) {
  const row = allAgents(page)
  await expect(row).toHaveAttribute('aria-current', 'true')
  // The mixed state is named in the row and read with its button.
  const status = page.locator(`[id="${await row.getAttribute('aria-describedby')}"]`)
  await expect(status).toHaveText(/^Mixed · 2 models · 2 levels/)
  // Nobody picked "All" yet: the row carries no check mark.
  await expect(dialog(page).getByTestId('party-route-chosen')).toHaveCount(0)
  // First in the Agents group, above each participant's own row (agents not invited follow them).
  const buttons = dialog(page).getByRole('button', { name: /^Configure / })
  await expect(buttons.first()).toHaveAccessibleName('Configure all agents')
  for (const label of ['Localix', 'Frontend', 'QA Engineer'])
    await expect(
      dialog(page).getByRole('button', { name: `Configure ${label}`, exact: true }),
    ).toHaveCount(1)
}
