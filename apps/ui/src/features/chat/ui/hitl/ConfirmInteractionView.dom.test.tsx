import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConfirmAnswers, PendingConfirmInteraction } from './ConfirmInteractionView'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const FILE = '/home/me/code/other/src/hooks/useTheme.ts'

/** The card from the report: a sub-agent reading a file outside the workspace. */
const subagentRead = (
  payload: Partial<PendingConfirmInteraction['request']['payload']> = {},
): PendingConfirmInteraction => ({
  kind: 'confirm',
  request: {
    id: 'perm:1',
    kind: 'confirm',
    title: 'Read useTheme.ts',
    payload: {
      command: FILE,
      subject: 'path',
      description: 'This reads a path outside the project workspace.',
      sourceKind: 'subagent',
      sourceTitle: 'LX-8: shadcn/ui, themes',
      grants: [
        {
          id: `read(${FILE})`,
          kind: 'path',
          label: 'useTheme.ts',
          covers: '~/code/…/useTheme.ts',
          target: FILE,
        },
        {
          id: 'read(/home/me/code/other/src/hooks/*)',
          kind: 'folder',
          label: 'hooks',
          covers: 'anything inside ~/code/other/src/hooks',
          target: '/home/me/code/other/src/hooks',
          rule: 'read(/home/me/code/other/src/hooks/*)',
        },
        {
          id: 'read(/home/me/code/other/src/*)',
          kind: 'folder',
          label: 'src',
          covers: 'anything inside ~/code/other/src',
          target: '/home/me/code/other/src',
          rule: 'read(/home/me/code/other/src/*)',
        },
      ],
      ...payload,
    },
  },
})

async function mount(interaction: PendingConfirmInteraction) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ConfirmInteractionView } = await import('./ConfirmInteractionView')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const answers: ConfirmAnswers[] = []
  await React.act(async () => {
    root.render(
      <ConfirmInteractionView
        interaction={interaction}
        submitting={false}
        onSubmit={(_id, answer) => answers.push(answer)}
        onDismiss={() => {}}
      />,
    )
  })
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(label),
    )
  const radio = (value: string) =>
    host.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)
  const act = React.act
  const unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, answers, button, radio, act, unmount }
}

describe('the confirmation card', () => {
  test('shows WHAT is asked even when a sub-agent asks — and who asked above it', async () => {
    // The card in the report showed only the sub-agent's task title; the file was nowhere.
    const card = await mount(subagentRead())
    try {
      expect(card.host.textContent).toContain('useTheme.ts')
      expect(card.host.textContent).toContain('/home/me/code/other/src/hooks/')
      expect(card.host.textContent).toContain('LX-8: shadcn/ui, themes')
      expect(card.host.textContent).toContain('outside the project workspace')
    } finally {
      await card.unmount()
    }
  })

  test('two answers in the footer, whatever the card can widen to — and the reply beside them', async () => {
    const card = await mount(subagentRead())
    try {
      const footer = card.host.querySelector('[aria-label="Request actions"]')
      const labels = [...(footer?.querySelectorAll('button') ?? [])].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent,
      )
      expect(labels).toEqual(['Reply to the sub-agent', 'Denyesc', 'Approve↵'])
    } finally {
      await card.unmount()
    }
  })

  test('the path IS the level picker: a folder segment widens from there down', async () => {
    // The level used to be a separate Scope select repeating the path's own folders.
    const card = await mount(subagentRead())
    try {
      expect(card.host.querySelector('[role="combobox"]')).toBeNull()
      const trail = card.host.querySelector('[data-slot="confirm-scope-trail"]')
      // Above the shallowest offered level is one address, not three dead segments.
      expect(trail?.firstElementChild?.textContent).toBe('/home/me/code/other')
      const segments = [...(trail?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
      expect(segments).toEqual(['src', 'hooks', 'useTheme.ts'])

      // Picking a folder while still `Once` means "allow this folder": it moves to the session.
      await card.act(async () => card.button('src')?.click())
      expect(card.radio('session')?.checked).toBe(true)
      expect(card.button('src')?.getAttribute('aria-pressed')).toBe('true')
      expect(card.host.textContent).toContain('anything inside ~/code/other/src')
      await card.act(async () => card.button('Approve')?.click())
      expect(card.answers.at(-1)).toEqual({
        confirmed: true,
        scope: 'session',
        grant: 'read(/home/me/code/other/src/*)',
      })
    } finally {
      await card.unmount()
    }
  })

  test('nothing is said about scope while the answer is Once', async () => {
    const card = await mount(subagentRead())
    try {
      expect(card.host.textContent).not.toContain('Won’t ask again')
      const pressed = card.host.querySelectorAll(
        '[data-slot="confirm-scope-trail"] [aria-pressed="true"]',
      )
      expect(pressed).toHaveLength(0)
    } finally {
      await card.unmount()
    }
  })

  test('Approve alone approves once; a widened answer names the folder level', async () => {
    const card = await mount(subagentRead())
    try {
      await card.act(async () => card.button('Approve')?.click())
      expect(card.answers.at(-1)).toEqual({ confirmed: true })

      await card.act(async () => card.radio('always')?.click())
      expect(card.host.textContent).toContain('anything inside ~/code/other/src/hooks')
      await card.act(async () => card.button('Approve')?.click())
      // The level defaults to the file's FOLDER, not the file: one card per file in a folder
      // is the request that prompted this.
      expect(card.answers.at(-1)).toEqual({
        confirmed: true,
        scope: 'always',
        grant: 'read(/home/me/code/other/src/hooks/*)',
      })
    } finally {
      await card.unmount()
    }
  })

  test('Always is unavailable where the chosen level has no rule to write', async () => {
    const card = await mount(
      subagentRead({
        grants: [{ id: 'bash(git)', kind: 'program', label: 'git', covers: 'every git command' }],
      }),
    )
    try {
      expect(card.radio('always')?.disabled).toBe(true)
      expect(card.radio('session')?.disabled).toBe(false)
    } finally {
      await card.unmount()
    }
  })

  test('with nothing to widen to, the card offers no breadth at all', async () => {
    const card = await mount(subagentRead({ grants: undefined }))
    try {
      expect(card.host.querySelector('[data-slot="confirm-grant-controls"]')).toBeNull()
    } finally {
      await card.unmount()
    }
  })

  test('a reply to the sub-agent travels with the refusal', async () => {
    const card = await mount(subagentRead())
    try {
      const replyButton = () =>
        card.host.querySelector<HTMLButtonElement>('button[aria-label="Reply to the sub-agent"]')
      await card.act(async () => replyButton()?.click())
      // Opened, the button gives way to the field.
      expect(replyButton()).toBeNull()
      const field = card.host.querySelector<HTMLTextAreaElement>('textarea')
      expect(field).not.toBeNull()
      await card.act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          field,
          'Read src/theme.ts instead',
        )
        field!.dispatchEvent(
          new field!.ownerDocument.defaultView!.Event('input', { bubbles: true }),
        )
      })
      await card.act(async () => card.button('Deny')?.click())
      expect(card.answers.at(-1)).toEqual({
        confirmed: false,
        message: 'Read src/theme.ts instead',
      })
    } finally {
      await card.unmount()
    }
  })
})
