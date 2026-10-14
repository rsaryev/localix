import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { resolveNavScope, scopePath } from '@/shared/routing/routes'

/**
 * Two guards of different kinds, deliberately.
 *
 * 1. The URGENT-COMMIT fence is a NEGATIVE source assertion, and stays one. There is
 *    no seam that lets us observe "react-router committed urgently" without a full
 *    render, and a negative assertion ("this file must not contain startTransition")
 *    is falsifiable in the only direction that matters: reintroducing the regression
 *    makes it red. That is a legitimate architectural fence, not a change-detector.
 *
 * 2. The ROUTING RULES are now tested for real, against the pure `resolveNavScope` /
 *    `scopePath` they delegate to. They used to be source assertions, and were the
 *    bad kind:
 *
 *      - `toMatch(/goToSession[\s\S]*scopePath\(/)` was VACUOUS. `[\s\S]*` spans the
 *        whole file, so it only checked that the two tokens appear in that order
 *        ANYWHERE. Rewriting goToSession to `go('/BROKEN')` — the exact regression it
 *        names — left it green, because `scopePath(` still appeared further down in
 *        `openSection`.
 *      - `toMatch(/opts\?\.project !== undefined \? opts\.project : projectId/)` pinned
 *        an exact ternary. It happened to catch a `??` regression, but it was equally
 *        red on a reformat — it could not tell a bug from a whitespace change.
 *
 *    The behavior both were reaching for is pure and now lives behind a name, so it
 *    can be exercised directly instead of described in a regex.
 *
 * The bug the urgent-commit fence guards: wrapping user navigation in `startTransition`
 * marked the URL update low-priority. The steady stream of urgent store updates from
 * active/background chat sessions (message.delta etc.) kept restarting the transition
 * render, so react-router never committed the new `:sessionId`, the URL→store sync in
 * ChatPage never fired, and the view stayed on the previous (sub-)session until a
 * reload forced an urgent commit. Clicking "back to the root chat" appeared to do
 * nothing; a reload fixed it.
 */

const source = readFileSync(
  fileURLToPath(new URL('./useRoutedNavigation.ts', import.meta.url)),
  'utf8',
)

describe('useRoutedNavigation — navigation must commit urgently', () => {
  test('does not import useTransition', () => {
    expect(source).not.toMatch(/useTransition/)
  })

  test('does not defer navigation through a startTransition() call', () => {
    // Match the call shape, not the word — the explanatory comment names it.
    expect(source).not.toMatch(/startTransition\(/)
  })
})

describe('resolveNavScope — an explicit project beats the URL scope', () => {
  test('an explicit project wins over the current URL scope', () => {
    // Callers pass the session's OWN project ({ project: session.projectId ?? null }).
    // Inferring scope from the stale URL is what bounced same-scope clicks to Global.
    expect(resolveNavScope('p2', 'p1')).toBe('p2')
  })

  test('an explicit project wins over the URL scope', () => {
    expect(resolveNavScope('p2', 'p1')).toBe('p2')
  })

  test('undefined means "caller did not say" and keeps the current scope', () => {
    expect(resolveNavScope(undefined, 'p1')).toBe('p1')
    expect(resolveNavScope(undefined, null)).toBe(null)
  })
})

describe('scopePath — hierarchical scope→session URLs', () => {
  test('encodes the project scope as a path segment', () => {
    expect(scopePath('p1', 's1')).toBe('/project/p1/s1')
  })

  test('preserves the open sidebar section across a session switch', () => {
    expect(scopePath('p1', 's1', 'files')).toBe('/project/p1/s1/files')
  })

  test('a scope with no session resolves to the scope root', () => {
    expect(scopePath('p1')).toBe('/project/p1')
  })
})
