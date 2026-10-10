import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('Git contributes status items, it does not draw them', () => {
  const items = read('statusItems.ts')
  const register = read('../register.tsx')

  test('keeps repository status in the titlebar without duplicate composer pills', () => {
    expect(register).toContain("id: 'git-workspace:branch'")
    expect(register).toContain("placement: 'titlebar'")
    expect(register).not.toContain("placement: 'composer'")
    expect(register.match(/useItem: useGitBranchStatusItem/gu)).toHaveLength(1)
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

  test('divergence is METRICS, not text', () => {
    // Folding them into `text` would cost the tone and the `tabular-nums` alignment that stop a
    // live counter from shoving its neighbours sideways as it ticks.
    expect(items).toContain('metrics:')
    expect(items).toContain('ArrowUp')
    expect(items).toContain('ArrowDown')
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

  test('the item does not render when there is nothing to say', () => {
    // An empty control is worse than the absence it stands for: it invites a click that does
    // nothing and it occupies chrome a user cannot reclaim.
    expect(items).toContain('if (!status?.isRepo || !sessionId) return null')
  })
})
