import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const captureRoot = path.resolve(
  process.env.LOCALIX_CAPTURE_ROOT || path.join(os.tmpdir(), 'localix-doc-captures'),
)
export const fixtureFile = path.join(captureRoot, 'fixture.json')
export const databaseFile = path.join(captureRoot, 'localix.db')
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
  const result = await response.json()
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(result)}`)
  return result
}

export async function prepare() {
  const projectRoot = path.join(captureRoot, 'release-studio')
  await fs.mkdir(captureRoot, { recursive: true })
  await fs.cp(path.join(repoRoot, 'docs/assets/screenshots/fixtures/release-studio'), projectRoot, {
    recursive: true,
    // Leave a composed board and other persisted fixture work intact on reruns.
    force: false,
    errorOnExist: false,
  })
  console.log(`Capture root: ${captureRoot}`)
  console.log(
    `LOCALIX_DB_FILE=${databaseFile} PORT=5151 LOCALIX_DEV_UI_PORT=5150 bun run dev:workspace`,
  )
  return projectRoot
}

if (import.meta.main) await prepare()
