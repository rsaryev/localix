import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act, type ReactNode } from 'react'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { codeSnippet, type CodeSnippet } from '@/shared/lib/codeSnippetBus'
import { terminal } from '@/shared/lib/terminalBus'
import { registerDom } from '@localixai/kit/testing/dom'
import { CodeBlock } from './CodeBlock'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

/** Render into a fresh root, as a transcript of `sessionId` would (or outside any chat). */
async function renderIn(sessionId: string | null, node: ReactNode) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => {
    root.render(<WorkItemSessionProvider sessionId={sessionId}>{node}</WorkItemSessionProvider>)
  })
  return { container, unmount: () => act(async () => root.unmount()) }
}

describe('CodeBlock actions', () => {
  test("sends a shell snippet to its own chat's terminal without executing it", async () => {
    const sentToA: string[] = []
    const sentToB: string[] = []
    // The bus deliberately retains a command until its chat's terminal connects. Drain any
    // pending value left by an earlier isolation test before observing this action.
    terminal.setActiveSender('S-A', () => {})()
    terminal.setActiveSender('S-B', () => {})()
    const releaseA = terminal.setActiveSender('S-A', (command) => sentToA.push(command))
    const releaseB = terminal.setActiveSender('S-B', (command) => sentToB.push(command))
    const view = await renderIn(
      'S-A',
      <CodeBlock code={'echo ready\n'} language="bash" syntaxHighlight={false} />,
    )

    try {
      const run = view.container.querySelector<HTMLButtonElement>('[aria-label="Send to terminal"]')
      await act(async () => run?.click())

      expect(sentToA).toEqual(['echo ready'])
      expect(sentToB).toEqual([])
    } finally {
      await view.unmount()
      releaseA()
      releaseB()
    }
  })

  test('opens a supported snippet in the chat that shows it', async () => {
    const opened: CodeSnippet[] = []
    const releaseHandler = codeSnippet.setHandler((snippet) => opened.push(snippet))
    const view = await renderIn(
      'S-A',
      <CodeBlock code={'select 1;\n'} language="sql" syntaxHighlight={false} />,
    )

    try {
      const open = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Open in the editor"]',
      )
      await act(async () => open?.click())

      expect(open).not.toBeNull()
      expect(opened).toEqual([{ sessionId: 'S-A', ext: 'sql', code: 'select 1;' }])
    } finally {
      await view.unmount()
      releaseHandler()
    }
  })

  test('outside any chat neither action renders, so neither can guess a chat', async () => {
    const releaseHandler = codeSnippet.setHandler(() => {})
    const shell = await renderIn(
      null,
      <CodeBlock code="echo ready" language="bash" syntaxHighlight={false} />,
    )
    const sql = await renderIn(
      null,
      <CodeBlock code="select 1;" language="sql" syntaxHighlight={false} />,
    )

    try {
      expect(shell.container.querySelector('[aria-label="Send to terminal"]')).toBeNull()
      expect(sql.container.querySelector('[aria-label="Open in the editor"]')).toBeNull()
    } finally {
      await shell.unmount()
      await sql.unmount()
      releaseHandler()
    }
  })
})
