import { describe, expect, test } from 'bun:test'

/**
 * ONE invalidation protocol, for every plugin.
 *
 * "This data just moved, and the surfaces showing it are somewhere else" is a cross-cutting
 * problem, and five bundled plugins solved it five times with the same twenty lines: a module
 * holding a `Set` of listeners, an `announceX`, a `subscribeX`. The duplication was not the
 * expensive part. TWO of the five were quietly incomplete — Database had a reader and a refresh
 * function with nothing in between, and the API client announced only for the agent's writes — so
 * a titlebar glyph went on naming an environment the user had switched away from, and a database
 * they had disconnected. A mechanism each plugin re-derives is a mechanism some plugins get wrong.
 *
 * `plugin-sdk/ui/resource-topics` is that mechanism now: `resourceTopic(name)` is imported by both
 * sides, a writer calls `.invalidate()`, and `createSharedResource(load, { topic })` follows it by
 * construction. This guard is what stops the sixth copy.
 *
 * The positive control at the bottom is what makes a green run mean something: the detector is
 * also satisfied by a scanner that reads nothing, so it is run against a planted defect too.
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname

/**
 * A hand-rolled announce/subscribe pair.
 *
 * Anchored on the EXPORTED announce verb rather than on `new Set`, because a set of listeners is a
 * perfectly ordinary thing for a plugin to own (a store, a bus, a watcher over someone else's
 * events). What is not ordinary is a plugin exporting its own "something changed, go and look"
 * broadcast — that is this protocol, spelled again.
 */
const HAND_ROLLED_ANNOUNCE =
  /export\s+(?:async\s+)?function\s+(?:announce|notify|broadcast|publish)\w*(?:Change|Changed|Update|Updated|Moved|Invalidat\w*)\s*\(/u

/** …and the other half, which is what makes it a protocol rather than a callback. */
const HAND_ROLLED_SUBSCRIBE =
  /export\s+function\s+subscribe\w*(?:Change|Changes|Updates?|Moves?)\s*\(/u

interface Offence {
  readonly path: string
  readonly reason: string
}

async function pluginUiFiles(): Promise<string[]> {
  const paths: string[] = []
  for (const path of new Bun.Glob('*/{ui,frontend}/**/*.{ts,tsx}').scanSync({
    cwd: `${REPO_ROOT}/plugins`,
  })) {
    if (path.includes('node_modules') || path.includes('/dist/')) continue
    if (/\.(?:test|spec|dom\.test)\.tsx?$/u.test(path)) continue
    paths.push(`plugins/${path}`)
  }
  return paths.sort()
}

function detect(source: string): string | null {
  const announces = HAND_ROLLED_ANNOUNCE.test(source)
  const subscribes = HAND_ROLLED_SUBSCRIBE.test(source)
  if (!announces || !subscribes) return null
  return 'declares its own announce/subscribe pair — use `resourceTopic()` from plugin-sdk/ui/resource-topics'
}

describe('the resource invalidation protocol has one implementation', () => {
  test('no plugin re-declares an announce/subscribe pair of its own', async () => {
    const offences: Offence[] = []
    for (const path of await pluginUiFiles()) {
      const reason = detect(await Bun.file(`${REPO_ROOT}/${path}`).text())
      if (reason) offences.push({ path, reason })
    }
    expect(offences.map((offence) => `${offence.path} — ${offence.reason}`)).toEqual([])
  })

  test('every plugin that names a topic namespaces it with its own name', async () => {
    // `resourceTopic('boards')` from two plugins is one topic, and each would refresh on the
    // other's writes. The namespace is what keeps a global registry from colliding.
    const offences: string[] = []
    for (const path of await pluginUiFiles()) {
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      for (const match of source.matchAll(/resourceTopic\(\s*'([^']*)'/gu)) {
        const name = match[1] ?? ''
        const plugin = path.split('/')[1] ?? ''
        if (!name.startsWith(`${plugin}:`)) {
          offences.push(`${path} — topic '${name}' is not namespaced as '${plugin}:…'`)
        }
      }
    }
    expect(offences).toEqual([])
  })

  test('positive control: the detector reports its planted defect and stays quiet otherwise', () => {
    const planted = [
      'const listeners = new Set<() => void>()',
      'export function subscribeCourseChanges(listener: () => void) { listeners.add(listener) }',
      'export function announceCourseChange() { for (const l of listeners) l() }',
    ].join('\n')
    expect(detect(planted)).not.toBeNull()

    // Half a protocol is a callback, not a second implementation of this one.
    expect(detect('export function announceCourseChange() {}')).toBeNull()
    // …and the sanctioned shape reports nothing.
    expect(
      detect(
        [
          "import { resourceTopic } from '@localixai/plugin-sdk/ui/resource-topics'",
          "export const ACME_COURSES = resourceTopic('acme:courses')",
        ].join('\n'),
      ),
    ).toBeNull()
  })
})
