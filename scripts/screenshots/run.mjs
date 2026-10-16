import { promises as fs } from 'node:fs'
import path from 'node:path'
import { captureRoot, fixtureFile, repoRoot, verifyDemoRuntime } from './runtime.mjs'
import { publishCaptures } from './publish.mjs'
import { ensureFixtureService } from './fixture-service.mjs'

await verifyDemoRuntime()
const args = process.argv.slice(2)
const update = args.includes('--update')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runRoot = path.join(captureRoot, 'runs', stamp)
await fs.mkdir(runRoot, { recursive: true })
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
      ...args.filter((arg) => arg !== '--update'),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, LOCALIX_CAPTURE_RUN: runRoot },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  const exitCode = await runner.exited
  await fs.writeFile(
    path.join(captureRoot, 'latest-run.json'),
    JSON.stringify({ root: runRoot, passed: exitCode === 0 }),
  )
  if (exitCode) process.exitCode = exitCode
  else if (update) {
    await publishCaptures(runRoot)
    const generator = Bun.spawn(['bun', 'run', '--cwd', 'apps/landing', 'generate'], {
      cwd: repoRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    process.exitCode = await generator.exited
  } else
    console.log(`Review captures: ${runRoot}\nAfter visual review: bun run screenshots:publish`)
} finally {
  service.stop()
}
