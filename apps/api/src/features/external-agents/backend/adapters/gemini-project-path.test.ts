/**
 * Which directory a Gemini chat was recorded in.
 *
 * The recording does not say, so this adapter reported no working directory at all — honest, but
 * every such session landed in the statistics' "no working directory recorded" bucket, out of reach
 * of any project filter. Gemini keeps the answer beside the recordings in `~/.gemini/projects.json`,
 * a map of ABSOLUTE PATH → the short directory name a chat is filed under, so the attribution comes
 * from the provider's own file rather than from a guess.
 *
 * With the map wired in, a chat filed under `sample-project` resolves to
 * `/Users/dev/Documents/sample-project`, one filed under `frontend` to
 * `.../sample-project/packages/frontend`, and the project's bar counts both (the prefix folds the
 * subpath in) while the unattributed bucket shrinks accordingly.
 *
 * What these cases hold is the refusals. `cwdPrefix` is a PREFIX filter: a wrong path does not read
 * as wrong, it quietly moves sessions into another project's bar.
 */

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { geminiCliAdapter } from './gemini-cli'
import type { AdapterEnv } from './types'

const DOC = JSON.stringify({
  sessionId: 'doc-side-id',
  startTime: '2026-04-03T18:35:00.000Z',
  lastUpdated: '2026-04-03T18:40:00.000Z',
  messages: [{ id: 'm0', type: 'user', content: 'find the flag' }],
})

/** `dirs` are the project directories a chat is filed under; `projects` is Gemini's own map. */
async function home(dirs: readonly string[], projects?: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'gemini-proj-'))
  for (const dir of dirs) {
    const chats = join(root, '.gemini', 'tmp', dir, 'chats')
    await mkdir(chats, { recursive: true })
    await writeFile(join(chats, `session-${dir}.json`), DOC, 'utf8')
  }
  if (projects) {
    await mkdir(join(root, '.gemini'), { recursive: true })
    await writeFile(join(root, '.gemini', 'projects.json'), JSON.stringify({ projects }), 'utf8')
  }
  return root
}

async function cwdOf(env: AdapterEnv, dir: string): Promise<string | undefined> {
  const refs = await geminiCliAdapter.listSources(env)
  const summaries = await geminiCliAdapter.readSummaries(refs, env)
  return summaries.find((s) => s.nativeSessionId === `session-${dir}`)?.cwd
}

describe("a chat is attributed from Gemini's own map, or not at all", () => {
  test('a directory name the map names once resolves to that absolute path', async () => {
    const root = await home(['sample-project'], {
      '/Users/dev/Documents/sample-project': 'sample-project',
    })

    expect(await cwdOf({ env: {}, homeDir: root }, 'sample-project')).toBe(
      '/Users/dev/Documents/sample-project',
    )
  })

  test('a name claimed by two paths resolves to neither', async () => {
    // Gemini derives the short name from the last path segment, so two checkouts of one repo
    // collide. Picking either would file half the sessions under the wrong project.
    const root = await home(['frontend'], {
      '/Users/dev/Documents/sample-project/packages/frontend': 'frontend',
      '/Users/dev/Documents/other/packages/frontend': 'frontend',
    })

    expect(await cwdOf({ env: {}, homeDir: root }, 'frontend')).toBeUndefined()
  })

  test('an older 64-hex directory resolves by hashing the paths the map lists', async () => {
    // Synthetic fixture: `5465db9e…` is sha256 of `/Users/dev/Documents/sample-project`. The
    // digest is matched forward, never inverted.
    const path = '/Users/dev/Documents/sample-project'
    const digest = createHash('sha256').update(path).digest('hex')
    const root = await home([digest], { [path]: 'sample-project' })

    expect(await cwdOf({ env: {}, homeDir: root }, digest)).toBe(path)
  })

  test('a digest naming a path the map no longer lists stays unresolved', async () => {
    const digest = createHash('sha256').update('/Users/dev/Documents/deleted').digest('hex')
    const root = await home([digest], { '/Users/dev/Documents/sample-project': 'sample-project' })

    expect(await cwdOf({ env: {}, homeDir: root }, digest)).toBeUndefined()
  })

  test('a directory the map does not mention keeps no working directory', async () => {
    const root = await home(['bin'], { '/Users/dev/Documents/sample-project': 'sample-project' })

    expect(await cwdOf({ env: {}, homeDir: root }, 'bin')).toBeUndefined()
  })

  test('no map at all is the honest silence this adapter had before', async () => {
    const root = await home(['sample-project'])

    expect(await cwdOf({ env: {}, homeDir: root }, 'sample-project')).toBeUndefined()
    // And the session is still listed: attribution is a field, not a filter on what exists.
    expect(await geminiCliAdapter.listSources({ env: {}, homeDir: root })).toHaveLength(1)
  })

  test('a malformed map is ignored rather than throwing the scan away', async () => {
    const root = await home(['sample-project'])
    await writeFile(join(root, '.gemini', 'projects.json'), '{ not json', 'utf8')

    expect(await cwdOf({ env: {}, homeDir: root }, 'sample-project')).toBeUndefined()
  })

  test('GEMINI_CLI_HOME moves the map with the recordings it describes', async () => {
    // The map lives beside `tmp`, so a replaced root has to take both or the chats resolve against
    // the developer's own home.
    const root = await home(['sample-project'], { '/work/app': 'sample-project' })

    expect(
      await cwdOf({ env: { GEMINI_CLI_HOME: root }, homeDir: '/nonexistent' }, 'sample-project'),
    ).toBe('/work/app')
  })
})
