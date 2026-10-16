import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { localixHome } from '../../lib/env'
import { hostRoots } from '../../lib/host-roots'
import { isPathWithin } from '../../lib/path-containment'
import { HOST_ROOT_DENIAL } from './host-root-guard'
import { createPermissionGate } from './permission-gate'
import type { PermissionRule } from './permission-engine'
import { AGENT_ALLOWED_ROOTS } from './tools/workspace'

/**
 * The guard is proved against the REAL host roots of this process — the checkout the test runs
 * from — so a green run means the running application is protected, not a fixture. Every case
 * runs with an allow-everything rule — the list a mode that stops asking leaves behind — because
 * the claim is that nothing a user can configure lifts it.
 */

const CHECKOUT = path.resolve(import.meta.dir, '../../../../..')
const PROJECT = mkdtempSync(path.join(tmpdir(), 'host-root-guard-'))
symlinkSync(CHECKOUT, path.join(PROJECT, 'linked-app'))
afterAll(() => rmSync(PROJECT, { recursive: true, force: true }))

const ALLOW_ALL: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'allow' }]

async function verdict(
  toolName: string,
  input: Record<string, unknown>,
  root: string | undefined = PROJECT,
  roots?: readonly string[],
) {
  const gate = createPermissionGate({
    rules: ALLOW_ALL,
    toolsByName: new Map(),
    root,
    ...(roots ? { hostRoots: roots } : {}),
  })
  return gate({ toolCallId: 'c', toolName, input })
}

const blocked = (result: Awaited<ReturnType<typeof verdict>>): boolean =>
  Boolean(result && 'block' in result && result.block)

describe('host-root guard', () => {
  test('this process has the checkout as a host root', () => {
    expect(hostRoots().some((r) => isPathWithin(r, path.join(CHECKOUT, 'package.json')))).toBe(true)
  })

  test('denies file tools, bash cwd and bash tokens inside the application', async () => {
    const file = path.join(CHECKOUT, 'apps/api/package.json')
    const read = await verdict('read', { path: file })
    expect(blocked(read)).toBe(true)
    expect((read as { blockedMessage: string }).blockedMessage).toContain(HOST_ROOT_DENIAL)
    expect(blocked(await verdict('write', { path: file, content: 'x' }))).toBe(true)
    // `edit` once produced no path facts, so this rewrote the application unseen.
    expect(
      blocked(await verdict('edit', { path: file, old_string: '"name"', new_string: '"x"' })),
    ).toBe(true)
    expect(blocked(await verdict('bash', { command: 'ls', cwd: CHECKOUT }))).toBe(true)
    expect(blocked(await verdict('bash', { command: `cat ${file}` }))).toBe(true)
    expect(
      blocked(await verdict('bash', { commands: ['echo ok', `rm -rf ${CHECKOUT}/apps`] })),
    ).toBe(true)
  })

  test('a symlink in the project that points into the application is judged by its target', async () => {
    expect(blocked(await verdict('read', { path: 'linked-app/package.json' }))).toBe(true)
  })

  test('paths outside the home dir are still seen (packaged installs live there)', async () => {
    const app = '/Applications/Localix.app'
    expect(blocked(await verdict('bash', { command: `ls ${app}/Contents` }, PROJECT, [app]))).toBe(
      true,
    )
  })

  test('~/.localix and the project stay open', async () => {
    const state = path.join(localixHome(), 'workspace', 'notes.md')
    expect(blocked(await verdict('read', { path: state }))).toBe(false)
    expect(blocked(await verdict('write', { path: state, content: 'x' }))).toBe(false)
    expect(blocked(await verdict('read', { path: path.join(PROJECT, 'a.ts') }))).toBe(false)
    expect(blocked(await verdict('bash', { command: 'ls ./src' }))).toBe(false)
  })

  test('a session whose project IS the checkout keeps working on it', async () => {
    const file = path.join(CHECKOUT, 'apps/api/package.json')
    expect(blocked(await verdict('read', { path: file }, CHECKOUT))).toBe(false)
    expect(blocked(await verdict('bash', { command: 'ls' }, path.join(CHECKOUT, 'apps/ui')))).toBe(
      false,
    )
  })

  test('the agent-owned allowed roots never whitelist a host root', () => {
    for (const allowed of AGENT_ALLOWED_ROOTS) {
      for (const host of hostRoots()) {
        expect(isPathWithin(allowed, host)).toBe(false)
        expect(isPathWithin(host, allowed)).toBe(false)
      }
    }
  })
})
