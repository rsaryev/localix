import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  api,
  captureRoot,
  databaseFile,
  prepare,
  verifyDemoRuntime,
  fixtureFile,
} from './runtime.mjs'

/**
 * The Store's captures need a home of their own: a person's Store has a few mini apps installed
 * and the rest on offer, while the other scenarios need every one installed. Run this against a
 * capture API started with its own `HOME` (scripts/screenshots/README.md, "Store evidence"). It
 * writes the fixture the runner opens and installs three mini apps through the Store, once: the
 * first three of the catalog by id, so the fixture names none. It never removes anything, so a
 * home that already holds others fails the scenario's count instead.
 */
export const STORE_INSTALL_COUNT = 3

/**
 * What the person wrote themselves, for the Yours captures: a skill and an MCP server, made through
 * the Store's own create route. Only those scenarios have them: the others count what is installed.
 */
export const YOURS = [
  {
    kind: 'skill',
    id: 'user:release-notes',
    values: {
      name: 'release-notes',
      description: 'Write release notes from the commits since the last tag',
      content: 'List what a person using the app will notice, most important first.\n',
    },
  },
  {
    kind: 'mcp-server',
    id: 'docs-search',
    values: {
      name: 'docs-search',
      description: 'Search the team docs',
      transport: 'http',
      url: 'https://docs.example.com/mcp',
      headers: { Authorization: 'Bearer demo-token' },
    },
  },
]
export const YOURS_SCENARIOS = ['store-yours', 'store-mcp-settings', 'store-archive-unused']

/** A skill of the person's that was never used and is 60 days old: what Archive unused lists. */
export const STALE_SKILL = 'old-standup'

export async function clearYours() {
  for (const item of YOURS) {
    try {
      await api(`/store/${item.kind}/${encodeURIComponent(item.id)}/remove`, { scope: 'user' })
    } catch {
      /* Not there yet. */
    }
  }
}

export async function seedYours() {
  await clearYours()
  for (const item of YOURS)
    await api(`/store/create/${item.kind}`, { scope: 'user', values: item.values })
}

/**
 * Make the stale skill for `store-archive-unused`: a skill made in Localix (its usage row says so,
 * as the curator only ages those), written into the capture home's `.claude/skills` and dated back
 * 60 days, as the curator ages a skill by its row and file.
 */
export async function seedStaleSkill() {
  const dir = path.join(captureRoot, 'home', '.claude', 'skills', STALE_SKILL)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  await fs.writeFile(
    file,
    `---\nname: ${STALE_SKILL}\ndescription: Summarize the daily standup notes\n---\nList what changed since yesterday.\n`,
  )
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  await fs.utimes(file, sixtyDaysAgo, sixtyDaysAgo)
  await fs.utimes(dir, sixtyDaysAgo, sixtyDaysAgo)
  const { Database } = await import('bun:sqlite')
  const db = new Database(databaseFile, { strict: true })
  try {
    const at = sixtyDaysAgo.toISOString()
    db.run('DELETE FROM skill_usage WHERE skill_name = ? AND project_id = ?', [STALE_SKILL, ''])
    db.run(
      `INSERT INTO skill_usage(id,user_id,project_id,skill_name,scope,get_count,pinned,localix_authored,created_at,updated_at)
       VALUES (?,?,?,?,?,0,0,1,?,?)`,
      [crypto.randomUUID(), 'local-user', '', STALE_SKILL, 'global', at, at],
    )
  } finally {
    db.close()
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function miniApps() {
  return (await api('/store/listings?shelf=package:mini-app')).listings
}

/** The ids of the mini apps the capture home has installed. */
export async function installedMiniApps() {
  return (await miniApps())
    .filter((listing) => listing.installs.length > 0 && !listing.job?.error)
    .map((listing) => listing.ref.id)
}

/**
 * The mini app whose page shows what the Store's page is for: pictures and a screen of its own.
 * The first of the catalog, by id, that has both.
 */
export async function showcaseMiniApp() {
  const ids = (await miniApps()).map((listing) => listing.ref.id).sort()
  for (const id of ids) {
    const detail = await api(`/store/mini-app/${encodeURIComponent(id)}`)
    if (detail.media.length > 0 && detail.components.some((item) => item.kind === 'screen'))
      return id
  }
  throw new Error('No mini app in the catalog has pictures and a screen to show.')
}

export async function seedStore() {
  // What an earlier Yours capture left would count as installed.
  await clearYours()
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
    const first = before.map((listing) => listing.ref.id).sort()
    for (const id of first.slice(0, STORE_INSTALL_COUNT))
      await api(`/store/mini-app/${encodeURIComponent(id)}/install`, {
        scope: 'user',
        consent: { plan: false },
      })
  }
  // Each install is a job: wait until all of them have landed.
  for (let attempt = 0; attempt < 240; attempt++) {
    if ((await installedMiniApps()).length >= STORE_INSTALL_COUNT) return
    const failed = (await miniApps()).find((listing) => listing.job?.phase === 'failed')
    if (failed) throw new Error(`${failed.ref.id} did not install: ${failed.job.error}`)
    await wait(500)
  }
  throw new Error('The Store fixture installs did not finish')
}

if (import.meta.main) {
  await verifyDemoRuntime()
  await seedStore()
  console.log(`Installed through the Store: ${(await installedMiniApps()).join(', ')}`)
}
