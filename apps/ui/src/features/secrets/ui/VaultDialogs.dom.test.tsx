import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { SecretMeta } from '@localixai/api/client'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const item: SecretMeta = {
  id: 'wallet-1',
  key: 'RECOVERY_WALLET',
  label: 'Recovery wallet',
  type: 'crypto_wallet',
  source: 'user',
  backend: 'local',
  version: 2,
  tags: [],
  reference: 'secret:RECOVERY_WALLET',
  createdAt: 1,
  updatedAt: 1,
}

const button = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  )

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  const InputEvent = input.ownerDocument.defaultView?.Event ?? Event
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

describe('Vault dialog feedback', () => {
  test('keeps high-impact guidance flat and uses the shared activity signal while rotating', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { secretsApi } = await import('@/shared/api/secretsApi')
    const { Dialog } = await import('@localixai/kit/dialog')
    const { VaultItemDialogBody } = await import('./VaultItemDialog')
    let finish: (() => void) | undefined
    const rotate = spyOn(secretsApi, 'rotate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ...item, version: 3 })
        }),
    )
    const container = document.createElement('div')
    const testDocument = container.ownerDocument
    testDocument.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <Dialog open>
          <VaultItemDialogBody
            open
            mode="rotate"
            item={item}
            onOpenChange={() => {}}
            onSaved={() => {}}
          />
        </Dialog>,
      )
      await settle()
    })

    const warning = Array.from(testDocument.body.querySelectorAll('div')).find((node) =>
      node.textContent?.startsWith('High-impact item'),
    )
    expect(warning).toBeDefined()

    const secretInput = testDocument.body.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement
    await act(async () => setInputValue(secretInput, 'replacement secret'))
    const submit = button(testDocument.body, 'Create version')
    expect(submit?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      submit?.click()
      await Promise.resolve()
    })
    expect(rotate).toHaveBeenCalledTimes(1)
    expect(submit?.getAttribute('aria-busy')).toBe('true')
    expect(submit?.textContent).toContain('Creating version')

    await act(async () => {
      finish?.()
      await Promise.resolve()
    })
    await act(async () => root.unmount())
    container.remove()
    rotate.mockRestore()
  })

  test('renders consumer checks, warnings and deletion progress without status cards', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Dialog } = await import('@localixai/kit/dialog')
    const { VaultDeleteDialogBody } = await import('./VaultDeleteDialog')
    const binding = {
      consumerType: 'plugin',
      consumerId: 'database-tools',
      field: 'credential',
      label: 'Database tools',
    }
    const container = document.createElement('div')
    const testDocument = container.ownerDocument
    testDocument.body.append(container)
    const root = createRoot(container)
    const render = (
      loadingBindings: boolean,
      deleting: boolean,
      error: { message: string } | null = null,
    ) => (
      <Dialog open>
        <VaultDeleteDialogBody
          open
          item={item}
          bindings={loadingBindings ? [] : [binding]}
          loadingBindings={loadingBindings}
          deleting={deleting}
          error={error}
          onOpenChange={() => {}}
          onConfirm={() => {}}
        />
      </Dialog>
    )

    await act(async () => {
      root.render(render(true, false))
      await settle()
    })
    expect(testDocument.body.textContent).toContain('Checking consumers')

    await act(async () =>
      root.render(render(false, false, { message: 'This Vault item could not be deleted.' })),
    )
    const consumerWarning = Array.from(testDocument.body.querySelectorAll('div')).find((node) =>
      node.textContent?.startsWith('This item is used by 1 consumer'),
    )
    expect(consumerWarning).toBeDefined()
    expect(testDocument.body.querySelector('[role="alert"]')?.textContent).toContain(
      'This Vault item could not be deleted.',
    )

    await act(async () => root.render(render(false, true)))
    const deleting = button(testDocument.body, 'Deleting')
    expect(deleting?.getAttribute('aria-busy')).toBe('true')

    await act(async () => root.unmount())
    container.remove()
  })
})
