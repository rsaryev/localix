import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

/**
 * Git is the first consumer of the status-item seam, and it uses it in two places at once — the
 * titlebar and the composer row — from ONE declaration placed twice.
 *
 * That matters more than it looks. Those were two separate hand-written components before, and
 * they had already disagreed about how to draw the same fact: the titlebar button rendered
 * `↑2↓1` with lucide arrows at one size, the composer pill with its own markup at another. A
 * declaration cannot disagree with itself.
 */
describe('Git contributes status items, it does not draw them', () => {
  const items = read('statusItems.ts')
  const register = read('../register.tsx')

  test('one branch declaration is placed in both rows', () => {
    expect(register).toContain("id: 'git-workspace:branch'")
    expect(register).toContain("placement: 'titlebar'")
    expect(register).toContain("id: 'git-workspace:composer-branch'")
    expect(register).toContain("id: 'git-workspace:changes'")
    expect(register).toContain("placement: 'composer'")
    // The SAME hook behind the titlebar item and the composer pill — two registrations, one
    // description of what the repository currently is.
    expect(register.match(/useItem: useGitBranchStatusItem/gu)).toHaveLength(2)
    expect(register).toContain('useItem: useGitChangesStatusItem')
  })

  test('the hand-written titlebar button is gone', () => {
    // It carried its own height (`h-7`, not the chrome token), no focus ring and no press
    // feedback, between two host buttons that had all three. Deleting it is the point of the seam.
    expect(existsSync(resolve(here, 'BreadcrumbGitAction.tsx'))).toBe(false)
    expect(register).not.toContain('BreadcrumbGitAction')
    expect(register).not.toContain("surface: 'breadcrumb.trailing'")
  })

  test('the declaration renders nothing itself', () => {
    // A `.ts` file, not `.tsx`: there is no JSX to write, which is the cheapest possible proof.
    expect(existsSync(resolve(here, 'statusItems.tsx'))).toBe(false)
    expect(items).not.toContain('className')
    expect(items).not.toContain('chromeAction')
  })

  test('divergence and diff stats are METRICS, not text', () => {
    // Folding them into `text` would cost the tone and the `tabular-nums` alignment that stop a
    // live counter from shoving its neighbours sideways as it ticks.
    expect(items).toContain('metrics:')
    expect(items).toContain('ArrowUp')
    expect(items).toContain('ArrowDown')
    expect(items).toContain("tone: 'success' as const")
    expect(items).toContain("tone: 'error' as const")
    expect(items).not.toMatch(/text:.*↑/u)
  })

  test('the branch item offers a menu, and it is data', () => {
    expect(items).toContain('const menu: MenuEntry[]')
    expect(items).toContain("id: 'switch'")
    // A branch is ONE choice: radio rows (`selected`), the current branch included and marked —
    // never `checked: false` checkboxes with the current branch left out.
    expect(items).toContain('selected: candidate.name === status.branch')
    expect(items).not.toContain('checked:')
    expect(items).toContain('disabled: behind === 0')
    expect(items).toContain('disabled: ahead === 0')
  })

  test('neither item renders when there is nothing to say', () => {
    // An empty control is worse than the absence it stands for: it invites a click that does
    // nothing and it occupies chrome a user cannot reclaim.
    expect(items).toContain('if (!status?.isRepo || !sessionId) return null')
    // Nor without a chat: the click opens that chat's Git tab, and there is no other one to pick.
    expect(items).toContain(
      'if (!sessionId || !status?.isRepo || status.stats.files === 0) return null',
    )
  })
})
