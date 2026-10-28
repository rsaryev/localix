import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { McpElicitationAnswer } from '@localixai/api/client'
import type { PendingMcpElicitationInteraction } from '@/shared/api/contracts'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const formRequest = (): PendingMcpElicitationInteraction => ({
  kind: 'mcp_elicitation',
  request: {
    id: 'call-1',
    kind: 'mcp_elicitation',
    title: 'issue-tracker asks for input',
    expiresAt: Date.now() + 60_000,
    payload: {
      server: 'issue-tracker',
      message: 'Which project should the issue go to?',
      mode: 'form',
      requestedSchema: {
        type: 'object',
        properties: {
          project_key: { type: 'string', title: 'Project key', minLength: 2 },
          count: { type: 'integer', title: 'Copies', minimum: 1 },
          labels: {
            type: 'array',
            title: 'Labels',
            items: { type: 'string', enum: ['bug', 'docs'] },
          },
          notify: { type: 'boolean', title: 'Notify the team' },
        },
        required: ['project_key'],
      },
    },
  },
})

async function mount(interaction: PendingMcpElicitationInteraction) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { McpElicitationInteractionView } = await import('./McpElicitationInteractionView')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const answers: McpElicitationAnswer[] = []
  const dismissed: string[] = []
  await React.act(async () => {
    root.render(
      <McpElicitationInteractionView
        interaction={interaction}
        submitting={false}
        onSubmit={(_id, answer) => answers.push(answer)}
        onDismiss={(id) => dismissed.push(id)}
      />,
    )
  })
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(label),
    )
  const field = (label: string) =>
    [...host.querySelectorAll<HTMLLabelElement>('label')].find((l) =>
      l.textContent?.startsWith(label),
    )?.control as HTMLInputElement | null
  const type = async (input: HTMLInputElement | null | undefined, value: string) => {
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const click = (target: HTMLElement | null | undefined) =>
    React.act(async () => {
      target?.click()
    })
  const unmount = async () => {
    await React.act(async () => root.unmount())
    host.remove()
  }
  return { host, answers, dismissed, button, field, type, click, unmount }
}

describe('the MCP elicitation card', () => {
  test('shows the server, its message and one control per field', async () => {
    const card = await mount(formRequest())
    try {
      expect(card.host.textContent).toContain('issue-tracker')
      expect(card.host.textContent).toContain('Which project should the issue go to?')
      for (const label of ['Project key', 'Copies', 'Notify the team', 'bug', 'docs'])
        expect(card.host.textContent).toContain(label)
    } finally {
      await card.unmount()
    }
  })

  test('Submit sends nothing until the answer fits the form, then only its fields', async () => {
    const card = await mount(formRequest())
    try {
      await card.click(card.button('Submit'))
      expect(card.answers).toEqual([])
      expect(card.host.textContent).toContain('Required')

      await card.type(card.field('Project key'), 'D')
      await card.click(card.button('Submit'))
      expect(card.answers).toEqual([])
      expect(card.host.textContent).toContain('At least 2 characters')

      await card.type(card.field('Project key'), 'DOCS')
      await card.type(card.field('Copies'), '3')
      await card.click(card.host.querySelector<HTMLInputElement>('fieldset input'))
      await card.click(card.field('Notify the team'))
      await card.click(card.button('Submit'))
      expect(card.answers).toEqual([
        {
          action: 'accept',
          content: { project_key: 'DOCS', count: 3, labels: ['bug'], notify: true },
        },
      ])
    } finally {
      await card.unmount()
    }
  })

  test('Decline declines; Cancel (Esc) dismisses, which the server reads as cancel', async () => {
    const card = await mount(formRequest())
    try {
      await card.click(card.button('Decline'))
      expect(card.answers).toEqual([{ action: 'decline' }])
      await card.click(card.host.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]'))
      expect(card.dismissed).toEqual(['call-1'])
    } finally {
      await card.unmount()
    }
  })

  test('a URL request shows the link and accepts on Open', async () => {
    const request = formRequest()
    request.request.payload = {
      server: 'auth',
      message: 'Sign in to continue',
      mode: 'url',
      url: 'https://auth.example.com/login',
      elicitationId: 'e-1',
    }
    const opened: string[] = []
    // No desktop bridge here, so the link leaves through `window.open`.
    window.open = ((url?: string | URL) => {
      opened.push(String(url))
      return null
    }) as typeof window.open
    const card = await mount(request)
    try {
      expect(card.host.textContent).toContain('https://auth.example.com/login')
      await card.click(card.button('Open'))
      expect(opened).toEqual(['https://auth.example.com/login'])
      expect(card.answers).toEqual([{ action: 'accept' }])
    } finally {
      await card.unmount()
    }
  })
})
