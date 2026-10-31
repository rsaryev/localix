import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const captureRoot = path.resolve(
  process.env.LOCALIX_CAPTURE_ROOT || path.join(os.tmpdir(), 'localix-doc-captures'),
)
export const fixtureFile = path.join(captureRoot, 'fixture.json')
export const databaseFile = path.join(captureRoot, 'localix.db')
/** The capture API's own home: the mini apps it installs never land in a person's `~/.localix`. */
export const homeDir = path.join(captureRoot, 'home')
export const uiOrigin = 'http://127.0.0.1:5150'
export const apiOrigin = 'http://127.0.0.1:5151'

export async function verifyDemoRuntime() {
  const temporaryRoots = await Promise.all([os.tmpdir(), '/tmp'].map((root) => fs.realpath(root)))
  const realRoot = await fs.realpath(captureRoot)
  if (
    !temporaryRoots.some((root) => realRoot.startsWith(`${root}${path.sep}`)) ||
    !/^localix-.*capture/.test(path.basename(realRoot))
  )
    throw new Error('Capture data must live in a dedicated temporary directory.')
  const identity = createHash('sha256')
    .update(await fs.realpath(databaseFile))
    .digest('hex')
    .slice(0, 24)
  const descriptor = JSON.parse(await fs.readFile(`${databaseFile}.api-runtime.json`, 'utf8'))
  if (descriptor.baseUrl !== apiOrigin || descriptor.databaseId !== identity) {
    throw new Error('Start the isolated capture API; never seed a personal workspace.')
  }
  // The seed installs mini apps through the Store, into the API's home: it must be the capture's.
  const env = spawnSync('ps', ['-wwE', '-p', String(descriptor.pid), '-o', 'command='], {
    encoding: 'utf8',
  }).stdout
  const home = env.match(/(?:^|\s)HOME=(\S+)/)?.[1]
  if (!home || !(await fs.realpath(home)).startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(
      `Start the capture API with HOME=${homeDir}; it reads ${home ?? 'an unknown home'}.`,
    )
  }
  const response = await fetch(`${apiOrigin}/health`)
  const health = await response.json()
  if (
    !response.ok ||
    health.databaseId !== identity ||
    health.instanceId !== descriptor.instanceId
  ) {
    throw new Error('The isolated capture API is unavailable or serves a different database.')
  }
}

export async function api(route, body, method = body === undefined ? 'GET' : 'POST') {
  const request = {
    method,
    headers: { 'content-type': 'application/json', 'x-localix-client': '1', Origin: uiOrigin },
  }
  if (body !== undefined) {
    if (method === 'GET' || method === 'HEAD')
      throw new Error('A read request cannot carry a body.')
    request.body = JSON.stringify(body)
  }
  const response = await fetch(`${apiOrigin}/rpc${route}`, request)
  const result = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(result)}`)
  return result
}

export async function prepare() {
  const projectRoot = path.join(captureRoot, 'release-studio')
  await fs.mkdir(homeDir, { recursive: true })
  await fs.cp(path.join(repoRoot, 'docs/assets/screenshots/fixtures/release-studio'), projectRoot, {
    recursive: true,
    // Leave a composed board and other persisted fixture work intact on reruns.
    force: false,
    errorOnExist: false,
  })
  console.log(`Capture root: ${captureRoot}`)
  console.log(
    `HOME=${homeDir} LOCALIX_DB_FILE=${databaseFile} LOCALIX_DEV_API_PORT=5151 LOCALIX_DEV_UI_PORT=5150 VITE_DEV_HOST=127.0.0.1 bun scripts/dev-servers.mjs`,
  )
  return projectRoot
}

/**
 * Every mini app on the Store's shelf that installs without a yes (a publisher Localix verifies),
 * installed for the capture home as a person installs one. Community apps wait for a person's
 * confirmation, which the `store-consent` scenario asks for, so they stay on the shelf.
 */
export async function installEveryMiniApp() {
  const listings = async () =>
    (await api('/store/listings?shelf=package:mini-app')).listings.filter(
      (listing) => listing.publisher.verified,
    )
  for (const listing of await listings()) {
    if (listing.installs.length === 0 && !listing.job)
      await api(`/store/mini-app/${listing.ref.id}/install`, {
        scope: 'user',
        consent: { plan: false },
      })
  }
  // Each install is a job.
  for (let attempt = 0; attempt < 480; attempt++) {
    const all = await listings()
    const failed = all.find((listing) => listing.job?.phase === 'failed')
    if (failed) throw new Error(`${failed.ref.id} did not install: ${failed.job.error}`)
    if (all.every((listing) => listing.installs.length > 0)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The mini app installs did not finish.')
}

if (import.meta.main) await prepare()
