// The homepage's captures: the same scenarios as the docs, in a smaller 16:10 window, so the UI
// reads at the size of a card. Writes WebP into apps/landing/public/landing.
//
// On a FRESH capture root (LOCALIX_CAPTURE_ROOT), before `bun run screenshots:seed`:
//   bun scripts/screenshots/landing.mjs --pick-model
// picks the isolated placeholder connection once, so every chat the seed makes is born on a model
// (a composer that shows a model, not "Connect a provider", and no "now on" rows in a transcript).
// A session's route is decided at its birth, so this has to come first. Then:
//   bun scripts/screenshots/landing.mjs            capture, then write the WebP files
//   bun scripts/screenshots/landing.mjs --grep x   only the keys matching x
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { seedAgentCommand } from './agent-command.mjs'
import { api, captureRoot, repoRoot, verifyDemoRuntime } from './runtime.mjs'
import { ensureFixtureService } from './fixture-service.mjs'
import { fixtureFile } from './runtime.mjs'

/** Each homepage card's capture: a key of `plan.mjs`, and the file name the landing serves. */
export const LANDING_SHOTS = {
  'providers/model-browser': 'models',
  'browser/agent-preview': 'workspace',
  'chat/agent-card-live': 'subagents',
  'store/search-wide': 'store',
  'task-board/board': 'mini-apps',
}

/** CSS pixels of the window: 16:10, small enough that its text reads at a card's width. */
const VIEWPORT = '1200x750'
/** Width of the published WebP: twice a card's widest panel, for a sharp picture on a Retina screen. */
const OUT_WIDTH = 1600
const outDir = path.join(repoRoot, 'apps/landing/public/landing')

await verifyDemoRuntime()
const grep = process.argv.includes('--grep')
  ? process.argv[process.argv.indexOf('--grep') + 1]
  : null
const keys = Object.keys(LANDING_SHOTS).filter((key) => !grep || key.includes(grep))

if (process.argv.includes('--pick-model')) {
  // A chat of its own whose pick becomes the agent's most recent one: what new chats start on.
  const session = await api('/sessions', { title: 'Model pick' })
  await seedAgentCommand({ sessionId: session.id })
  console.log('Picked the placeholder model; now run bun run screenshots:seed.')
  process.exit(0)
}

const runRoot = path.join(captureRoot, 'landing', new Date().toISOString().replace(/[:.]/g, '-'))
const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
const service = await ensureFixtureService({ root: fixture.root })
try {
  const runner = Bun.spawn(
    [
      'bunx',
      'playwright',
      'test',
      '--config',
      'scripts/screenshots/playwright.config.mjs',
      '--grep',
      keys.map((key) => key.replace(/[/]/g, '\\/')).join('|'),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, LOCALIX_CAPTURE_RUN: runRoot, LOCALIX_CAPTURE_VIEWPORT: VIEWPORT },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (await runner.exited) throw new Error('A landing capture failed; nothing was written.')
} finally {
  service.stop()
}

await fs.mkdir(outDir, { recursive: true })
for (const key of keys) {
  const file = (await fs.readdir(path.join(runRoot, path.dirname(key)))).find(
    (name) => name.startsWith(`${path.basename(key)}--`) && name.endsWith('.png'),
  )
  const target = path.join(outDir, `${LANDING_SHOTS[key]}.webp`)
  await sharp(path.join(runRoot, path.dirname(key), file))
    .resize({ width: OUT_WIDTH })
    .webp({ quality: 86, effort: 6 })
    .toFile(target)
  console.log(`${key} → ${path.relative(repoRoot, target)}`)
}
console.log(`Review the PNGs in ${runRoot}`)
