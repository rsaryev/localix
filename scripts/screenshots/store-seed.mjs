import { promises as fs } from 'node:fs'
import { api, prepare, verifyDemoRuntime, fixtureFile } from './runtime.mjs'

/**
 * The Store's captures need a home of their own: a person's Store has a few mini apps installed
 * and the rest on offer, while the other scenarios need every one installed. Run this against a
 * capture API started with its own `HOME` (scripts/screenshots/README.md, "Store evidence"). It
 * writes the fixture the runner opens and installs three mini apps through the Store, once; it
 * never removes anything, so a home that already holds others fails the scenario's count instead.
 */
export const STORE_INSTALLED = ['kanban', 'git-workspace', 'documents']

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function miniApps() {
  return (await api('/store/listings?shelf=package:mini-app')).listings
}

export async function seedStore() {
  const root = await prepare()
  let fixture
  try {
    fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  } catch {
    /* First seed. */
  }
  if (!fixture) {
    const projects = await api('/projects')
    const list = Array.isArray(projects) ? projects : projects.projects
    const project =
      list.find((item) => item.workingDir === root) ??
      (await api('/projects', { name: 'Release Studio', workingDir: root }))
    const session = await api('/sessions', { title: 'Browse the Store', projectId: project.id })
    fixture = { root, projectId: project.id, sessionId: session.id }
    await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
  }
  const before = await miniApps()
  if (!before.some((listing) => listing.installs.length > 0)) {
    for (const id of STORE_INSTALLED)
      await api(`/store/mini-app/${id}/install`, { scope: 'user', consent: { plan: false } })
  }
  // Each install is a job: wait until all three have landed.
  for (let attempt = 0; attempt < 240; attempt++) {
    const listings = await miniApps()
    const landed = listings.filter((listing) => listing.installs.length > 0 && !listing.job?.error)
    if (STORE_INSTALLED.every((id) => landed.some((listing) => listing.ref.id === id))) return
    const failed = listings.find((listing) => listing.job?.phase === 'failed')
    if (failed) throw new Error(`${failed.ref.id} did not install: ${failed.job.error}`)
    await wait(500)
  }
  throw new Error('The Store fixture installs did not finish')
}

if (import.meta.main) {
  await verifyDemoRuntime()
  await seedStore()
  console.log(`Installed through the Store: ${STORE_INSTALLED.join(', ')}`)
}
