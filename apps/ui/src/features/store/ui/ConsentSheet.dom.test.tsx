import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const COMMUNITY = {
  id: 'lint',
  displayName: 'Lint',
  ref: { kind: 'plugin' as const, id: 'lint' },
  publisher: { name: 'Someone', verified: false },
  source: { id: 'ada/market', label: 'Ada’s market', trust: 'community' as const },
}

async function ask(project: { id: string; name: string } | null) {
  const view = await renderStore({
    listings: [listing(COMMUNITY)],
    project,
    target: { shelf: 'package:plugin' },
  })
  await view.click(view.button('Get Lint', view.card('lint')!))
  const sheet = document.body.querySelector<HTMLElement>('[role="dialog"]')!
  return { view, sheet }
}

describe('the consent sheet', () => {
  test('says where the package comes from and that nothing installs before Install', async () => {
    const { view, sheet } = await ask(null)
    try {
      expect(sheet.textContent).toContain('Ada’s market')
      expect(sheet.textContent).toContain('Community')
      expect(view.calls).toEqual([])
      await view.click(view.button('Cancel', sheet))
      expect(view.calls).toEqual([])
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('with no project open, a plugin has no scope to pick', async () => {
    const { view, sheet } = await ask(null)
    try {
      expect(sheet.querySelector('[aria-label="Install for"]')).toBeNull()
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install plugin/lint user consent'])
    } finally {
      await view.done()
    }
  })

  test('with a project open, Install can be for that project alone', async () => {
    const { view, sheet } = await ask({ id: 'p1', name: 'Atlas' })
    try {
      const picker = sheet.querySelector<HTMLElement>('[aria-label="Install for"]')!
      expect(picker).not.toBeNull()
      await view.openMenu(picker)
      const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
        o.textContent?.includes('Only Atlas'),
      )!
      await view.click(option)
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install plugin/lint project consent in p1'])
    } finally {
      await view.done()
    }
  })
})
