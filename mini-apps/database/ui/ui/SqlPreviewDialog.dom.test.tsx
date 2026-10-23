import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import { warmMiniAppUiComponents } from '@localixai/kit/testing/lent-components'

let teardown: () => Promise<void>
beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // A failed apply renders the host's lazy ProblemLine. Bind and warm it here rather than
  // depending on whichever other mini app suite happened to run first.
  await warmMiniAppUiComponents()
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('SQL preview keeps one Apply owner when the SQL changes mid-request', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  // Module replacements outlive mock.restore() and would replace editors in later suites.
  // A scoped export spy restores the host component when this test finishes.
  const codeEditorModule = await import('@localixai/kit/code-editor')
  const originalEditor = codeEditorModule.CodeEditor
  const editor = spyOn(codeEditorModule, 'CodeEditor').mockImplementation(({ value, ariaLabel }) =>
    React.createElement('pre', { 'aria-label': ariaLabel }, value),
  )
  const { SqlPreviewDialog } = await import('./SqlPreviewDialog')

  const pending = deferred()
  let calls = 0
  let sql = 'ALTER TABLE users ADD COLUMN first TEXT;'
  const onApply = async () => {
    calls += 1
    await pending.promise
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () => (
    <SqlPreviewDialog
      open
      title="Alter users"
      sql={sql}
      onApply={onApply}
      applyLabel="Apply changes"
      onClose={() => {}}
    />
  )

  try {
    await act(async () => {
      root.render(render())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const apply = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply changes'),
    )
    expect(apply).toBeDefined()

    await act(async () => {
      apply!.click()
      apply!.click()
      await Promise.resolve()
    })
    expect(calls).toBe(1)

    sql = 'ALTER TABLE users ADD COLUMN second TEXT;'
    await act(async () => root.render(render()))
    const currentApply = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Applying'),
    )
    expect(currentApply?.disabled).toBe(true)
    currentApply?.click()
    expect(calls).toBe(1)

    await act(async () => {
      pending.resolve()
      await pending.promise
    })
  } finally {
    await act(async () => root.unmount())
    container.remove()
    editor.mockRestore()
    expect(codeEditorModule.CodeEditor).toBe(originalEditor)
  }
})

test('a failed apply keeps its error after the caller refreshes the script', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const codeEditorModule = await import('@localixai/kit/code-editor')
  const originalEditor = codeEditorModule.CodeEditor
  const editor = spyOn(codeEditorModule, 'CodeEditor').mockImplementation(({ value, ariaLabel }) =>
    React.createElement('pre', { 'aria-label': ariaLabel }, value),
  )
  const { SqlPreviewDialog } = await import('./SqlPreviewDialog')

  // The real sequence for a partially-applied DDL batch: the apply rejects, the caller
  // re-reads the table to see what landed, and the previewed script therefore changes.
  let sql = 'ALTER TABLE users ADD COLUMN a TEXT;\nALTER TABLE users ADD COLUMN b TEXT;'
  let rerender: () => void = () => {}
  const onApply = async () => {
    // The caller's reload lands BEFORE the rejection reaches the dialog: `onApplied()`
    // commits to the schema store, whose subscribers re-render synchronously, and only then
    // does the error propagate. Re-rendering here reproduces that ordering — without it the
    // dialog's own `sql` snapshot is still the old one and the guard cannot be exercised.
    sql = 'ALTER TABLE users ADD COLUMN b TEXT;'
    rerender()
    throw new Error('Duplicate column name "a"')
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () => (
    <SqlPreviewDialog
      open
      title="Alter users"
      sql={sql}
      onApply={onApply}
      applyLabel="Apply changes"
      onClose={() => {}}
    />
  )

  rerender = () => root.render(render())

  try {
    await act(async () => {
      root.render(render())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const apply = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply changes'),
    )
    await act(async () => {
      apply!.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Duplicate column name "a"')
    expect(document.body.textContent).toContain('ADD COLUMN b')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    editor.mockRestore()
    expect(codeEditorModule.CodeEditor).toBe(originalEditor)
  }
})
