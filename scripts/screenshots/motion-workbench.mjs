import { expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { api as runtimeApi, fixtureFile } from './runtime.mjs'
import { openTool } from './scenarios.mjs'

export async function motionApi(path, body, method) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  return runtimeApi(
    `${path}?${new URLSearchParams({ sessionId: fixture.sessionId })}`,
    body,
    method,
  )
}
const api = motionApi
const DEMO = 'relay'

/** The fixture owns at most one film: a fork of the Relay direction. */
async function seedMotion(withFilm) {
  const state = await api('/motion/library')
  for (const project of state.projects)
    if (!withFilm || project.id !== DEMO) await api(`/motion/projects/${project.id}`, {}, 'DELETE')
  if (withFilm && !state.projects.some((project) => project.id === DEMO))
    await api('/motion/projects', { direction: 'relay' })
}
export async function composeMotion(page, scenario) {
  await seedMotion(scenario === 'motion-projects' || scenario === 'motion-film')
  await openTool(page, 'Motion Studio')
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible()
  if (scenario === 'motion-library' || scenario === 'motion-template-preview')
    await page.getByRole('button', { name: 'New film', exact: true }).click()
  if (scenario === 'motion-template-preview')
    await page.getByRole('button', { name: 'Blackout direction', exact: true }).click()
  if (scenario === 'motion-film')
    await page.getByRole('list', { name: 'Films' }).getByText('Relay', { exact: true }).click()
}
export async function verifyMotion(page, scenario) {
  if (scenario === 'motion-empty') {
    await expect(page.getByRole('button', { name: 'New film', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Films' })).toHaveCount(0)
    return
  }
  if (scenario === 'motion-library') {
    await expect(
      page.getByRole('heading', { name: 'Choose a direction', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Motion directions' }).getByRole('button'),
    ).toHaveCount(11)
    return
  }
  if (scenario === 'motion-template-preview') {
    await expect(page.getByRole('heading', { name: 'Blackout', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use direction', exact: true })).toBeEnabled()
    await expect(page.getByRole('region', { name: 'Blackout sample film' })).toBeVisible()
    return
  }
  if (scenario === 'motion-projects') {
    await expect(
      page.getByRole('list', { name: 'Films' }).getByText('Relay', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'New film', exact: true })).toBeVisible()
    return
  }
  await expect(page.getByRole('heading', { name: 'Relay', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Preview of Relay' })).toBeVisible()
  await expect(page.getByText('Sample copy — ask the agent to write your story')).toBeVisible()
}
