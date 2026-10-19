/**
 * Session E2E harness: a real Localix API, isolated, with a scripted model behind it.
 *
 * `startRuntime()` boots the API exactly as `bun run dev` does (`scripts/dev-api.mjs`, plugins
 * staged), but with `HOME` pointed at a fresh temporary directory, so its `~/.localix` — database,
 * vault, workspace, plugins — is its own and the person's installation is never read or written.
 * The scripted provider (`provider.mjs`) is preloaded into it; a placeholder connection routes every
 * agent to it. The returned handle drives sessions through the public HTTP API and reads back what
 * the model was sent. `stop()` kills the whole process group.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient, sessionHelpers } from './client.mjs'
import { PLACEHOLDER_KEY } from './placeholder.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
export const MODEL_ID = 'gpt-4o'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Agents the scenarios seat, beyond the shipped `localix`. Not starter-team handles. */
export const TEST_AGENTS = {
  checker: { label: 'Checker', description: 'Verifies releases.', leadershipPriority: 0 },
  writer: { label: 'Writer', description: 'Writes release notes.', leadershipPriority: 0 },
}

export async function startRuntime({ port = 5261, keep = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'localix-session-e2e-'))
  const home = path.join(root, 'home')
  await mkdir(home, { recursive: true })
  const requestLog = path.join(root, 'requests.jsonl')
  const serverLog = path.join(root, 'api.log')
  // Nothing of the person's runtime is inherited: no database path, port or plugin override.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(LOCALIX_|PORT$|BUN_OPTIONS$)/.test(key)),
  )
  const child = spawn('bun', ['scripts/dev-api.mjs'], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...env,
      HOME: home,
      PORT: String(port),
      LOCALIX_DB_FILE: path.join(home, '.localix', 'localix.db'),
      BUN_OPTIONS: `--preload=${path.join(here, 'provider.mjs')}`,
      SESSION_E2E_LOG: requestLog,
      // The real package cache: a fresh HOME must not re-download what is already installed.
      BUN_INSTALL_CACHE_DIR: path.join(os.homedir(), '.bun', 'install', 'cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const out = createWriteStream(serverLog)
  child.stdout.pipe(out)
  child.stderr.pipe(out)
  const base = `http://127.0.0.1:${port}`
  const stop = async () => {
    // No pid means the spawn failed; -undefined would be NaN, and 0 would signal our own group.
    if (child.pid === undefined) return
    const group = -child.pid
    try {
      process.kill(group, 'SIGTERM')
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 50 && child.exitCode === null; i += 1) await sleep(100)
    try {
      process.kill(group, 'SIGKILL')
    } catch {
      /* exited on SIGTERM */
    }
    if (!keep) await rm(root, { recursive: true, force: true })
  }
  try {
    await waitForHealth(base, child)
  } catch (error) {
    const tail = existsSync(serverLog) ? readFileSync(serverLog, 'utf8').slice(-4000) : ''
    await stop()
    throw new Error(`${error.message}\n--- api.log (tail) ---\n${tail}`)
  }
  const runtime = createClient(base, requestLog)
  return { ...runtime, root, serverLog, requestLog, stop, ...(await setup(runtime)) }
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The API exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      /* still booting */
    }
    await sleep(500)
  }
  throw new Error('The API did not become healthy within 3 minutes')
}

/** Create the test agents. A scripted run marks each one so the provider knows who speaks. */
async function createAgents(api, { marked }) {
  const agentIds = { localix: 'builtin:localix' }
  for (const [handle, agent] of Object.entries(TEST_AGENTS)) {
    const instructions = `${agent.description} Report what you found, with evidence.`
    const created = await api('/agents', {
      handle,
      ...agent,
      instructions: marked ? `[e2e:agent=${handle}] ${instructions}` : instructions,
    })
    agentIds[handle] = created.record.id
  }
  return agentIds
}

async function setup(runtime) {
  const connection = await runtime.api('/provider-connections', {
    providerId: 'openai',
    providerName: 'OpenAI',
    label: 'Session E2E',
    authType: 'api-key',
    apiKey: PLACEHOLDER_KEY,
  })
  // Group routing's decision model is served through OpenRouter; the placeholder key keeps its
  // `/systemone` calls with the scripted provider, which answers unconfidently unless told.
  await runtime.api('/provider-connections', {
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    label: 'Session E2E decisions',
    authType: 'api-key',
    apiKey: PLACEHOLDER_KEY,
  })
  const agentIds = await createAgents(runtime.api, { marked: true })
  const route = { connectionId: connection.id, modelId: MODEL_ID }
  return { connectionId: connection.id, agentIds, ...sessionHelpers(runtime, route, agentIds) }
}

/**
 * A runtime ATTACHED to an API that is already running, on a real connection the person chose —
 * for behaviour checks against a real model. Nothing is isolated, so everything it creates is
 * removed by `stop()`: its sessions first, then its agents. It refuses to start when an agent of
 * its own name already exists, rather than adopting and later deleting someone's agent.
 */
export async function attachRuntime({ base, connectionId, modelId, keep = false }) {
  const runtime = createClient(base, null)
  const { agents } = await runtime.api('/capabilities/snapshot')
  const taken = Object.keys(TEST_AGENTS).filter((handle) =>
    agents.some((agent) => agent.record.handle === handle),
  )
  if (taken.length)
    throw new Error(
      `Agents ${taken.join(', ')} already exist on ${base}; remove them or run isolated`,
    )
  const agentIds = await createAgents(runtime.api, { marked: false })
  const created = []
  const stop = async () => {
    if (keep) {
      console.log(
        `[session-e2e] kept sessions ${created.join(', ')} and agents ${Object.keys(TEST_AGENTS).join(', ')}`,
      )
      return
    }
    // Delegated children first: a behaviour run may hand work to child sessions of its own.
    const listed = await runtime.api('/sessions')
    const all = Array.isArray(listed) ? listed : listed.sessions
    const ours = new Set(created)
    for (let grew = true; grew;) {
      grew = false
      for (const row of all)
        if (row.parentSessionId && ours.has(row.parentSessionId) && !ours.has(row.id)) {
          ours.add(row.id)
          grew = true
        }
    }
    for (const id of [...ours].reverse()) await runtime.call(`/sessions/${id}`, undefined, 'DELETE')
    for (const handle of Object.keys(TEST_AGENTS))
      await runtime.call(`/agents/${handle}`, undefined, 'DELETE')
  }
  const helpers = sessionHelpers(runtime, { connectionId, modelId }, agentIds, created)
  return { ...runtime, root: base, agentIds, connectionId, stop, ...helpers }
}
