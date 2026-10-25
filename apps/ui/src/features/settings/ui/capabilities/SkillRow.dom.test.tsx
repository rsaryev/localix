import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SkillSummary } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const skill = {
  id: 'file:/home/.localix/skills/review/SKILL.md',
  name: 'review',
  enabled: true,
  description: 'Review a diff',
  tags: [],
  projectId: '',
  scope: 'global',
  source: 'file',
  updatedAt: '',
} as unknown as SkillSummary

async function render(props: { onOpen: (() => void) | undefined; calls: string[] }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SkillRow } = await import('./SkillRow')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <SkillRow
        skill={skill}
        projects={[]}
        busy={false}
        onToggle={() => props.calls.push('toggle')}
        onOpen={props.onOpen}
      />,
    ),
  )
  return {
    container,
    act,
    done: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

describe('a skill row', () => {
  test('switches the skill and opens its Store page, and offers nothing else to do to it', async () => {
    const calls: string[] = []
    const row = await render({ calls, onOpen: () => calls.push('open') })
    try {
      const labels = [...row.container.querySelectorAll('button')].map((b) => b.textContent?.trim())
      expect(labels).toEqual(['Settings'])
      await row.act(async () =>
        (row.container.querySelector('[aria-label="Disable /review"]') as HTMLElement).click(),
      )
      await row.act(async () => (row.container.querySelector('button') as HTMLElement).click())
      expect(calls).toEqual(['toggle', 'open'])
    } finally {
      await row.done()
    }
  })

  test('a skill with no Store page has no Settings button', async () => {
    const row = await render({ calls: [], onOpen: undefined })
    try {
      expect(row.container.querySelectorAll('button')).toHaveLength(0)
      expect(row.container.textContent).toContain('/review')
    } finally {
      await row.done()
    }
  })
})
