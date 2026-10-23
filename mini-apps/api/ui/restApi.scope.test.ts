/**
 * The client must NAME THE SESSION on every call — the one its caller belongs to.
 *
 * A collection is a directory inside a project, and the mini app's backend is wired once, so the
 * only thing that can say which project a call is about is the call itself. Miss one route and it
 * silently reads the collection under the API process's own working directory — the repo the app
 * was launched from, not the one the user is looking at. That failure is invisible: the request
 * list is simply empty, or worse, someone else's.
 *
 * So this reads the source rather than exercising each route: the claim is about ALL of them, and
 * a per-route test would pass for the twenty that were written and say nothing about the
 * twenty-first added later.
 */

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { u } from './restApi.transport'

/**
 * Both halves of the client. It is one module split in two — requests and environments — and the
 * claim is about EVERY request either of them makes, so scanning one would leave the other free to
 * lose its scope silently.
 */
const CLIENTS = ['restApi.ts', 'restApi.environments.ts'].map((file) =>
  path.join(import.meta.dir, file),
)

async function source(): Promise<string> {
  return (await Promise.all(CLIENTS.map((file) => Bun.file(file).text()))).join('\n')
}

/** The plumbing both halves share — where the scoped URL is actually built. */
async function transport(): Promise<string> {
  return Bun.file(path.join(import.meta.dir, 'restApi.transport.ts')).text()
}

/** Every SDK transport request argument in the client, up to its first comma. */
function fetchTargets(code: string): string[] {
  return [...code.matchAll(/miniAppApiFetch\(\s*([^,]+)/g)].map((m) => m[1]!.trim())
}

describe('every request carries its scope', () => {
  test('the scan is not void — it finds the client’s fetches', async () => {
    // A regex that matched nothing would make the assertion below vacuously true.
    expect(fetchTargets(await source()).length).toBeGreaterThan(10)
  })

  test('no request builds its path any way but the builder bound to the caller’s session', async () => {
    const offenders = fetchTargets(await source()).filter(
      (target) => !target.startsWith('u(sessionId)`'),
    )
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'A call built its own URL instead of using `u(sessionId)`, so it carries no ' +
            'sessionId and the backend will resolve the collection under the API process’s cwd ' +
            'rather than the project the user is in:\n  ' +
            offenders.map((target) => target.slice(0, 80)).join('\n  '),
    ).toEqual([])
  })

  test('the builder never looks the session up', async () => {
    // It used to read the host's ACTIVE chat at call time, so a workspace kept mounted for chat A
    // sent and saved against whichever chat was on screen. The session is the caller's argument.
    const code = await transport()
    expect(code).not.toContain('getSnapshot')
    expect(code).not.toContain('activeScope')
  })

  test('the named session rides every path, after an existing query too', () => {
    expect(u('chat-a')`/requests`).toBe('/rpc/api/requests?sessionId=chat-a')
    expect(u('chat a')`/requests/x/export?format=curl`).toBe(
      '/rpc/api/requests/x/export?format=curl&sessionId=chat%20a',
    )
  })
})
