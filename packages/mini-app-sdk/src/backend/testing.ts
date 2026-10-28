import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineAgentTool } from '@localixai/agent/agents'
import { z } from 'zod'
import type { MiniAppContext } from './context'
import type { MiniAppRouteScope } from './http'
import type { MiniAppRegistration } from './registration'
import type { SemanticIndexHost, SemanticMatch, SemanticSource } from './semantic'
import type { BackendSubsystem } from './subsystem'

/**
 * TESTING — a mini app tested through what the agent calls and what its screen requests, on
 * folders of its own. The host is not running in a test; these stand in for the parts of it a
 * backend touches, so a test reads as the behaviour: "the agent logs a meal, the screen lists it".
 */

/** The user and chat a test acts as. */
export const TEST_USER = 'test-user'
export const TEST_CHAT = 'test-chat'

/**
 * A `ctx` for `register(ctx)`: temporary data folders (removed by `await using`), the real
 * `defineTool` and `z`, `config` as given, and `host` services the test fakes (`decisions`,
 * `semantic`, `wake`). Anything else a backend reads is absent, as on a lean host.
 */
export async function testMiniAppContext(options: {
  name: string
  config?: MiniAppContext['config']
  host?: Partial<NonNullable<MiniAppContext['host']>>
}): Promise<MiniAppContext & AsyncDisposable> {
  const root = await mkdtemp(join(tmpdir(), `${options.name}-test-`))
  const ctx = {
    miniAppName: options.name,
    miniAppDir: root,
    userId: TEST_USER,
    dataDir: join(root, 'data'),
    stateDir: join(root, 'state'),
    cwd: root,
    config: options.config ?? {},
    z,
    defineTool: defineAgentTool,
    log: () => {},
    sessionStorage: {
      resolveDataDir: async (_userId: string, sessionId: string) => join(root, 'chats', sessionId),
    },
    ...(options.host ? { host: options.host } : {}),
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
  return ctx as unknown as MiniAppContext & AsyncDisposable
}

const backendOf = (registration: MiniAppRegistration): BackendSubsystem => {
  const backend = [registration.backend ?? []].flat()[0]
  if (!backend?.routeMount) throw new Error('This registration has no routes.')
  return backend
}

/**
 * Call a tool as the agent does, in `sessionId`'s chat. Resolves to its text and whether it
 * reported an error.
 */
export async function callTool(
  registration: MiniAppRegistration,
  name: string,
  input: unknown,
  options: { sessionId?: string } = {},
): Promise<{ text: string; isError: boolean }> {
  const tools = registration.tools ?? []
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) {
    throw new Error(`No tool "${name}": the tools are ${tools.map((t) => t.name).join(', ')}.`)
  }
  const sessionId = options.sessionId ?? TEST_CHAT
  const parsed = tool.inputSchema ? (tool.inputSchema as z.ZodType).parse(input) : input
  const result = await tool.execute(`call-${name}`, parsed, undefined, undefined, {
    session: { id: sessionId, scratchDir: tmpdir() },
  } as never)
  return { text: result.content, isError: result.isError === true }
}

/** Request one of the mini app's routes as its screen does: `path` is relative to `/rpc/<app>`. */
export async function requestRoute(
  registration: MiniAppRegistration,
  method: string,
  path: string,
  body?: unknown,
  options: { sessionId?: string } = {},
): Promise<{ status: number; json: unknown }> {
  const scope: MiniAppRouteScope = {
    userId: TEST_USER,
    projectId: '',
    cwd: tmpdir(),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  }
  const response = await backendOf(registration).routeMount!.app.request(
    path,
    {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    },
    scope,
  )
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

/**
 * A semantic index for `host: { semantic }` that matches by words instead of meaning: an item
 * matches when its text holds every word of the query. Like the real one it answers nothing until
 * `ready` — the embedding model is downloading — so a test covers both answers of a search tool.
 */
export function fakeSemantic(): SemanticIndexHost & { ready: boolean } {
  const sources = new Map<string, SemanticSource>()
  const fake = {
    ready: false,
    status: () => ({ ready: fake.ready }),
    registerSource(source: SemanticSource) {
      sources.set(source.collection, source)
      return () => sources.delete(source.collection)
    },
    changed: () => {},
    async query(_userId: string, collection: string, text: string): Promise<SemanticMatch[]> {
      const source = sources.get(collection)
      if (!fake.ready || !source) return []
      const words = text.toLowerCase().split(/\s+/u).filter(Boolean)
      const matches: SemanticMatch[] = []
      for (let cursor: string | null = null; ;) {
        const page = await source.scan(cursor, 100)
        for (const item of page.items) {
          const haystack = item.text.toLowerCase()
          if (!words.every((word) => haystack.includes(word))) continue
          matches.push({
            key: item.key,
            chunk: 0,
            excerpt: item.text,
            z: 3,
            gate: 2,
            cosine: 0.9,
            scope: null,
          })
        }
        if (!page.next) return matches
        cursor = page.next
      }
    },
  }
  return fake as unknown as SemanticIndexHost & { ready: boolean }
}
