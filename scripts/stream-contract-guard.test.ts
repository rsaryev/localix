import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The `/rpc/ws` stream contract, and the clients that must keep up with it.
 *
 * One multiplexed socket carries every live update, and its event union is consumed by a
 * reducer that ships INDEPENDENTLY of the host. Adding an event to the host is therefore not
 * a local change — a client that does not know the opcode drops it, silently, and the feature
 * simply never appears. Nothing announces that: no type error (the reducer narrows on a
 * string discriminant), no test, no runtime warning. The failure is a feature that "does not
 * work", with nothing pointing at the reason.
 *
 * So the contract is pinned as a SET, in both directions:
 *
 *   host → client   a published opcode no client handles is a feature that hangs
 *   client → host   a handled opcode the host cannot publish is dead code, and usually
 *                   the leftover of a rename that only landed on one side
 *
 * There is deliberately no exemption list. An event a client genuinely does not care about
 * still gets a handler that says so, where the next reader of that reducer will see it — which
 * is what the web reducer does in `applyStreamEvent/routed-elsewhere.ts`. A list in this file would
 * put that decision somewhere nobody reading the reducer will look.
 */

const repoRoot = resolve(import.meta.dir, '..')

/**
 * Every file the union is written across. It is one union and one opcode set on the wire; it is
 * two files because it answers two questions (the conversation, and the machine it runs on), and
 * a guard that read only the first would silently stop guarding half of it the day it was split.
 */
const HOST_CONTRACT = [
  'apps/api/src/features/chat/contracts/stream.ts',
  'apps/api/src/features/chat/contracts/stream-workspace.ts',
  'apps/api/src/features/realtime/resources.ts',
]
/**
 * Every reducer that must handle the whole union, by the surface it serves, as the files it is
 * written across. Keyed by surface so a second client (a future embedder) is one line, not a
 * rewrite of this file. A path ending in `/` is a folder: every non-test source file in it is
 * read, because the web reducer is an entry point plus one file per event family, and a guard
 * that read only the entry would see no handler at all and fail every opcode — or, worse, a
 * guard that read a fixed list of family files would silently stop guarding a new one.
 */
const CLIENTS = {
  'web UI': [
    'apps/ui/src/shared/api/applyStreamEvent.ts',
    'apps/ui/src/shared/api/applyStreamEvent/',
  ],
} as const

const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

/** The source files behind a client's paths, a folder expanded to its non-test `.ts` files. */
function clientFiles(paths: readonly string[]): string[] {
  return paths.flatMap((path) =>
    path.endsWith('/')
      ? readdirSync(resolve(repoRoot, path))
          .filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
          .sort()
          .map((name) => `${path}${name}`)
      : [path],
  )
}

/** Opcodes the host declares it can publish. */
function publishedOpcodes(): Set<string> {
  // The union's discriminants, written as `type: 'name'` in every member.
  const source = HOST_CONTRACT.map(read).join('\n')
  return new Set([...source.matchAll(/\btype:\s*'([a-z][a-z_.]*)'/gu)].map((match) => match[1]!))
}

/**
 * Opcodes a reducer source handles, in either shape a handler is written: a `case 'name'` of a
 * switch, or a `'name':` key of a handler map (a quoted key opening its own line — which is what
 * sets it apart from a quoted VALUE such as `kind: 'x'` or a type-union member `| 'x'`).
 */
function handlersIn(source: string): Set<string> {
  const cases = [...source.matchAll(/\bcase\s+'([a-z][a-z_.]*)'/gu)]
  const keys = [...source.matchAll(/^\s*'([a-z][a-z_.]*)'\s*:/gmu)]
  return new Set([...cases, ...keys].map((match) => match[1]!))
}

/** Opcodes a client's reducer handles, across every file it is written in. */
function handledOpcodes(paths: readonly string[]): Set<string> {
  return handlersIn(clientFiles(paths).map(read).join('\n'))
}

describe('the stream contract stays in sync with its clients', () => {
  test('the host publishes a non-trivial set — a guard over nothing guards nothing', () => {
    // If the scan ever stops matching (the union is rewritten in another shape), every
    // assertion below would pass vacuously. This is what notices.
    expect(publishedOpcodes().size).toBeGreaterThanOrEqual(30)
  })

  test('the handler detector finds both handler shapes and nothing else (positive control)', () => {
    const planted = [
      "switch (event.type) { case 'alpha.updated': return session }",
      'const reducers: StreamReducers<',
      "  | 'not.a.handler'",
      '> = {',
      "  'beta.updated': (session, event) => session,",
      "  'gamma.updated': untouched,",
      "  kind: 'delta.value',",
      '}',
    ].join('\n')
    expect([...handlersIn(planted)].sort()).toEqual([
      'alpha.updated',
      'beta.updated',
      'gamma.updated',
    ])
  })

  for (const [surface, paths] of Object.entries(CLIENTS)) {
    test(`${surface}: every file of the reducer is read — its folder is not skipped`, () => {
      // Each listed folder must contribute handlers, or its expansion has quietly broken and the
      // two assertions below are checking the entry file alone.
      for (const folder of paths.filter((path) => path.endsWith('/'))) {
        expect(handledOpcodes([folder]).size).toBeGreaterThan(0)
      }
    })
  }

  for (const [surface, path] of Object.entries(CLIENTS)) {
    test(`${surface}: handles every event the host can publish`, () => {
      const missing = [...publishedOpcodes()].filter((opcode) => !handledOpcodes(path).has(opcode))
      // Each of these is a live update this surface would drop on the floor.
      expect(missing).toEqual([])
    })

    test(`${surface}: handles nothing the host cannot publish`, () => {
      const stale = [...handledOpcodes(path)].filter((opcode) => !publishedOpcodes().has(opcode))
      // Usually a rename that landed on one side only, leaving a branch that never runs.
      expect(stale).toEqual([])
    })
  }
})
