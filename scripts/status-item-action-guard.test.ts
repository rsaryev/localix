import { describe, expect, test } from 'bun:test'

/**
 * A row in the chrome must DO something, or say why it did not.
 *
 * The reported symptom: choosing a database in the titlebar menu changed the glyph's text and,
 * as far as the person could tell, nothing else happened. Two separate causes, both of them the
 * same class of mistake, and both present in more than one plugin:
 *
 *   - a fire-and-forget call. `onSelect` returns `void`, so an asynchronous action has to dispose
 *     of its own rejection, and the two shapes a plugin reaches for both lose it. `void promise`
 *     leaves an unhandled rejection nobody sees; `promise.catch(() => {})` is worse, because it is
 *     deliberate. The row highlights, the menu closes, and there is no way to tell a refused action
 *     from a broken one. It was in the Database, DevOps, API and Git items at once;
 *   - a row whose only effect is invisible. Connecting a database in the background put nothing on
 *     screen, so the honest reading of the gesture — "show me this database" — was the one it did
 *     not do. That one is a design rule, not a detectable pattern, and it is why every list row in
 *     these items now opens, reveals or switches to the thing it names.
 *
 * This guard is the detectable half. `runPluginAction` from the SDK is the sanctioned shape: it
 * takes the sentence a person reads and puts the backend's own message underneath it.
 *
 * Scoped to STATUS ITEMS on purpose. An empty catch is often right elsewhere — a best-effort
 * cancel on unmount, a JSON parse that falls back — and a repo-wide ban would be noise. What is
 * never right is a control in permanent chrome that fails without saying so.
 *
 * The positive control at the bottom is what makes a green run mean something.
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname

/** Every file that builds a contributed status item. */
async function statusItemFiles(): Promise<string[]> {
  const paths: string[] = []
  for (const path of new Bun.Glob('**/*.ts').scanSync({ cwd: `${REPO_ROOT}/plugins` })) {
    if (path.includes('node_modules') || path.includes('/dist/')) continue
    if (!/(?:^|\/)statusItems?\.ts$/u.test(path)) continue
    paths.push(`plugins/${path}`)
  }
  return paths.sort()
}

/** `promise.catch(() => {})` and its spellings — a rejection deliberately dropped. */
const SWALLOWED = /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)\s*\)/u

/**
 * `void somethingApi.verb(...)` — a promise started and abandoned.
 *
 * Anchored on a CALL after `void`, so `void 0` and `void refreshBoards()` (synchronous, and named
 * as such) are not swept up; what it catches is the shape that starts network work.
 */
const ABANDONED = /\bvoid\s+\w+(?:Api|api)\b[\w.]*\(/u

interface Offence {
  readonly path: string
  readonly line: number
  readonly text: string
}

function scan(source: string, rule: RegExp): number[] {
  return source
    .split('\n')
    .map((line, index) => (rule.test(line) ? index + 1 : 0))
    .filter((lineNumber) => lineNumber > 0)
}

function report(offences: readonly Offence[]): string {
  return offences
    .map(
      (offence) =>
        `${offence.path}:${offence.line} — ${offence.text.trim()}\n    use runPluginAction(run, 'Could not …') so the person is told what did not happen`,
    )
    .join('\n')
}

describe('a status item never fails silently', () => {
  test('the scan is not void — it finds the status items', async () => {
    // A glob that matched nothing would make every assertion below vacuously true.
    expect((await statusItemFiles()).length).toBeGreaterThan(8)
  })

  test('no status item swallows a rejection', async () => {
    const offences: Offence[] = []
    for (const path of await statusItemFiles()) {
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      const lines = source.split('\n')
      for (const line of scan(source, SWALLOWED)) {
        offences.push({ path, line, text: lines[line - 1] ?? '' })
      }
    }
    expect(report(offences)).toBe('')
  })

  test('no status item starts a request and walks away from it', async () => {
    const offences: Offence[] = []
    for (const path of await statusItemFiles()) {
      const source = await Bun.file(`${REPO_ROOT}/${path}`).text()
      const lines = source.split('\n')
      for (const line of scan(source, ABANDONED)) {
        offences.push({ path, line, text: lines[line - 1] ?? '' })
      }
    }
    expect(report(offences)).toBe('')
  })

  test('positive control: each detector reports its planted defect and stays quiet otherwise', () => {
    expect(scan('void change.then(refresh).catch(() => {})\n', SWALLOWED)).toEqual([1])
    expect(
      scan('  void kubernetesApi.stopPortForward(id).catch(() => undefined)\n', SWALLOWED),
    ).toEqual([1])
    expect(scan('    void restApi.useEnvironment(name)\n', ABANDONED)).toEqual([1])
    expect(scan('    void databaseApi.reconnect(id)\n', ABANDONED)).toEqual([1])

    // …and quiet on the shapes it must not claim.
    expect(
      scan("runPluginAction(() => restApi.useEnvironment(name), 'Could not switch.')\n", ABANDONED),
    ).toEqual([])
    expect(
      scan("runPluginAction(() => restApi.useEnvironment(name), 'Could not switch.')\n", SWALLOWED),
    ).toEqual([])
    // A synchronous local call that happens to be discarded is not a lost rejection.
    expect(scan('    void refreshSpaceBoards(sessionId)\n', ABANDONED)).toEqual([])
    // A handler that actually says something is the point, not the ban.
    expect(
      scan(
        '    .catch((error) => toast.error("nope", { description: String(error) }))\n',
        SWALLOWED,
      ),
    ).toEqual([])
  })
})
