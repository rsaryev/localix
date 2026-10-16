import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act, type ComponentProps } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { FileEditorToolbar } from './FileEditorToolbar'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function mountToolbar(overrides: Partial<ComponentProps<typeof FileEditorToolbar>> = {}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const calls: string[] = []
  const noop = () => {}
  await act(async () =>
    root.render(
      <FileEditorToolbar
        dirty={false}
        saving={false}
        comments={[]}
        sendingComments={false}
        runningCommentAction={null}
        onRemoveComment={noop}
        onClearComments={noop}
        onSendComments={noop}
        onNavigateComment={noop}
        onCommentAction={noop}
        markdownFile={false}
        previewMarkdown={false}
        onTogglePreview={() => calls.push('preview')}
        onSave={() => calls.push('save')}
        copyText="file contents"
        {...overrides}
      >
        <span>Document symbols</span>
      </FileEditorToolbar>,
    ),
  )
  return {
    host,
    calls,
    async open() {
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="File actions"]')!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      return document.body.querySelector<HTMLElement>('[role="menu"][aria-label="File actions"]')!
    },
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('file editor action menu', () => {
  test('reserves a row for breadcrumbs and keeps actions out of the code until opened', async () => {
    const view = await mountToolbar()
    try {
      expect(view.host.querySelector('[data-slot="workbench-toolbar"]')).not.toBeNull()
      expect(view.host.querySelector('[data-slot="floating-action-group"]')).toBeNull()
      expect(view.host.textContent).toContain('Document symbols')
      expect(view.host.textContent).not.toContain('Copy file contents')
      const menu = await view.open()
      expect(menu).not.toBeNull()
      const save = menu.querySelector('[role="menuitem"]')!
      expect(save.getAttribute('aria-disabled')).toBe('true')
      expect(menu.textContent).toContain('Copy file contents')
      expect(menu.textContent).not.toContain('Outline')
      expect(menu.querySelector('[role="menuitemcheckbox"]')).toBeNull()
    } finally {
      await view.close()
    }
  })

  test('retains saving and markdown view actions', async () => {
    const view = await mountToolbar({ dirty: true, markdownFile: true, onToggleSplit: () => {} })
    try {
      expect(view.host.querySelector('[title="Unsaved changes"]')).not.toBeNull()
      const menu = await view.open()
      expect(menu.textContent).toContain('Preview markdown')
      expect(menu.textContent).toContain('Split preview')
      expect(menu.querySelector('[role="menuitemcheckbox"]')).toBeNull()
      const save = menu.querySelector<HTMLElement>('[role="menuitem"]')!
      expect(save.getAttribute('aria-disabled')).not.toBe('true')
      await act(async () => save.click())
      expect(view.calls).toEqual(['save'])
    } finally {
      await view.close()
    }
  })
})
