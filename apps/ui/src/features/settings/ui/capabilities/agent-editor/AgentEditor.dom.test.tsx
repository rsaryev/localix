import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'
import type { AgentRecord, AgentRecordInput, AgentSummary } from '@/shared/api/contracts'

// The model picker talks to the backend; that is not what these tests are about — the form's
// own decisions are. What the agent MAY USE is not here at all any more: it is the profile's
// other tabs, beside this form.
await mock.module('./AgentModelField', () => ({ AgentModelField: () => null }))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const shipped: AgentRecord = {
  id: 'builtin:lead',
  handle: 'lead',
  leadershipPriority: 2,
  label: 'Tech Lead',
  description: 'Talks through approach.',
  instructions: 'You are the tech lead.',
}

const customized = (over: Partial<AgentSummary> = {}): AgentSummary =>
  ({
    record: { ...shipped, instructions: 'You are MY tech lead.' },
    builtin: true,
    enabled: true,
    source: 'user',
    path: '/home/u/.localix/agents/lead.json',
    projectId: '',
    scope: 'global',
    invocations: { chat: 'allow' },
    ...over,
  }) as AgentSummary

const submit = () =>
  [...document.querySelectorAll('button')].find((b) => /^Save|^Create/.test(b.textContent ?? ''))!

const heading = () => [...document.querySelectorAll('h3')].map((h) => h.textContent).join(',')

const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto =
    el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mount(props: Record<string, unknown> & object) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { AgentEditor } = await import('./AgentEditor')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <AgentEditor
        busy={null}
        onSave={async () => {}}
        onCancel={() => {}}
        {...(props as Record<string, never>)}
      />,
    )
  })
  // The drawer portals out of `container`, so a test that left its tree mounted would be
  // read by the next one. Every test unmounts before it ends.
  const unmount = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { act, unmount }
}

describe('AgentEditor', () => {
  test('context controls participate in save and the inherited limit is described accurately', async () => {
    const onSave = mock(async (_input: AgentRecordInput) => {})
    const { act, unmount } = await mount({ agent: customized(), onSave })
    try {
      const skills = document.querySelector<HTMLTextAreaElement>('#agent-preload-skills')!
      expect(skills).not.toBeNull()
      await act(async () => typeInto(skills, 'review-rules\nproject-style'))
      await act(async () => submit().click())
      expect(onSave.mock.calls[0]?.[0].context?.preloadSkills).toEqual([
        'review-rules',
        'project-style',
      ])
      expect(document.querySelector<HTMLInputElement>('#agent-max-turns')?.placeholder).toBe(
        'Inherit run limit',
      )
      expect(document.querySelector('#agent-memory-scope')).not.toBeNull()
    } finally {
      await unmount()
    }
  })

  test('definition groups have accessible section names and shared settings hierarchy', async () => {
    const { unmount } = await mount({ agent: customized() })
    try {
      const sections = [...document.querySelectorAll('section[aria-labelledby]')]
      expect(sections).toHaveLength(5)
      expect(
        sections.map(
          (section) =>
            document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent,
        ),
      ).toEqual(['Identity', 'Model', 'Instructions', 'Context', 'Limits'])
      for (const section of sections) {
        expect(section.className).toContain('border-border-faint')
        expect(section.querySelector('h3')?.className).toContain('text-base')
      }
      expect(
        document
          .querySelector('label[for="agent-name"]')
          ?.closest('[data-slot="field"]')
          ?.querySelector('#agent-name'),
      ).not.toBeNull()
      expect(submit().dataset.size).toBe('xl')
    } finally {
      await unmount()
    }
  })

  test('invalid limits announce the field error and prevent saving; a correction saves the definition', async () => {
    const onSave = mock(async (_input: AgentRecordInput) => {})
    const { act, unmount } = await mount({ agent: customized(), onSave })
    try {
      const turns = document.querySelector<HTMLInputElement>('#agent-max-turns')!
      await act(async () => typeInto(turns, '0'))
      await act(async () => submit().click())
      expect(onSave).not.toHaveBeenCalled()
      expect(turns.getAttribute('aria-invalid')).toBe('true')
      const errorId = turns.getAttribute('aria-describedby')!.split(' ')[0]!
      expect(document.getElementById(errorId)?.getAttribute('role')).toBe('alert')
      await act(async () => typeInto(turns, '12'))
      await act(async () => submit().click())
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({
        handle: 'lead',
        limits: { maxTurns: 12 },
        leadershipPriority: 2,
        instructions: 'You are MY tech lead.',
      })
    } finally {
      await unmount()
    }
  })

  test('an extension-owned definition is read-only and names its actual owner', async () => {
    const { unmount } = await mount({
      agent: customized({
        record: { ...shipped, id: 'contribution:reviewer' },
        builtin: false,
        source: 'imported:extension-id',
        path: '',
        registration: {
          sourceId: 'extension-id',
          sourceName: 'review-pack',
          key: 'lead',
          revision: 1,
        },
      }),
    })
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.readOnly).toBe(true)
    // WHY it is read-only is the profile's line, not the form's — see `agentProvenance`. What
    // the form owes is the read-only state itself and a submit that cannot pretend otherwise.
    expect(document.body.textContent).not.toContain('Provided by review-pack')
    expect(submit().disabled).toBe(true)
    await unmount()
  })

  test('a local handle can be renamed while shipped handles remain locked', async () => {
    const onSave = mock(async (_input: AgentRecordInput) => {})
    const mine = await mount({
      agent: customized({
        record: { ...shipped, id: 'custom-id', handle: 'mine' },
        builtin: false,
        source: 'local',
      }),
      onSave,
    })
    try {
      const name = document.querySelector<HTMLInputElement>('#agent-name')!
      expect(name.readOnly).toBe(false)
      await mine.act(async () => typeInto(name, 'renamed'))
      await mine.act(async () => submit().click())
      expect(onSave.mock.calls[0]?.[0].handle).toBe('renamed')
    } finally {
      await mine.unmount()
    }
    const builtin = await mount({ agent: customized() })
    try {
      expect(document.querySelector<HTMLInputElement>('#agent-name')!.readOnly).toBe(true)
    } finally {
      await builtin.unmount()
    }
  })

  test('there is nothing to save until a field actually changes', async () => {
    const { act, unmount } = await mount({ agent: customized() })

    expect(document.body.textContent).toContain('Hierarchy priority')
    expect(document.querySelector<HTMLInputElement>('#agent-leadership-priority')?.value).toBe('2')
    expect(submit().disabled).toBe(true)

    const description = [...document.querySelectorAll('input')].find(
      (i) => i.value === 'Talks through approach.',
    )!
    await act(async () => typeInto(description, 'Talks through approach and trade-offs.'))
    expect(submit().disabled).toBe(false)

    // …and putting it back is not an edit either.
    await act(async () => typeInto(description, 'Talks through approach.'))
    expect(submit().disabled).toBe(true)
    await unmount()
  })

  test('invocation availability is not a kind field in the definition editor', async () => {
    const { unmount } = await mount({ agent: customized() })
    const kinds = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(kinds).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Worker role')
    expect(document.body.textContent).not.toContain('Permission mode')
    expect(heading()).toContain('Instructions')
    await unmount()
  })

  test('Restore stands with Cancel and Save, fills the fields, and writes nothing itself', async () => {
    let dropped = 0
    const { act, unmount } = await mount({
      agent: customized(),
      onLoadDefaults: async () => shipped,
      onDropOverride: async () => {
        dropped += 1
      },
    })

    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'You are MY tech lead.',
    )
    expect(heading()).toContain('Instructions')

    const restore = () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Restore')
    expect(restore()).toBeDefined()
    await act(async () => restore()!.click())

    expect(dropped).toBe(0)
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'You are the tech lead.',
    )
    expect(document.body.textContent).toContain('Defaults filled in')
    // Nothing left to restore, so the verb goes away; the save is now the one decision left.
    expect(restore()).toBeUndefined()
    expect(submit().disabled).toBe(false)
    expect(submit().textContent).toBe('Save defaults')

    // Saving a draft that IS the shipped one removes the override instead of writing a copy.
    await act(async () => submit().click())
    expect(dropped).toBe(1)
    await unmount()
  })

  test('agent editing does not contain an invocation kind or foreign permission mode', async () => {
    // Read from the same table `updateAgent` guards with: a control the server would refuse
    // must not look live. The kind and the tool dialect belong to the definition we ship.
    const shippedRole = await mount({ agent: customized() })
    const kind = () => document.querySelector<HTMLInputElement>('input[type="radio"]')!
    expect(kind()).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.readOnly).toBe(false)
    await shippedRole.unmount()

    const mine = await mount({
      agent: customized({
        record: { ...shipped, id: 'custom-id', handle: 'mine' },
        builtin: false,
        source: 'local',
      }),
    })
    expect(kind()).toBeNull()
    await mine.unmount()
  })

  test('an untouched system agent is offered no Restore at all', async () => {
    const { unmount } = await mount({
      agent: customized({ record: shipped, source: 'builtin' }),
      onLoadDefaults: async () => shipped,
    })
    expect(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Restore'),
    ).toBeUndefined()
    await unmount()
  })
})
