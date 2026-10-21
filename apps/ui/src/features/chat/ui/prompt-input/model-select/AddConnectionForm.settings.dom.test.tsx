import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ProviderEntry } from '@localixai/agent/catalog'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const azure: ProviderEntry = {
  id: 'azure',
  name: 'Azure',
  modelCount: 92,
  authType: 'api-key',
  settings: [
    {
      name: 'AZURE_RESOURCE_NAME',
      label: 'Azure resource name',
      placeholder: 'my-resource',
      required: true,
    },
  ],
}

const bedrock: ProviderEntry = {
  id: 'amazon-bedrock',
  name: 'Amazon Bedrock',
  modelCount: 40,
  authType: 'api-key',
  settings: [{ name: 'AWS_REGION', label: 'AWS region', placeholder: 'us-east-1', required: true }],
}

/** Type into a React-controlled input the way a person does. */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('adding a cloud connection', () => {
  test('asks for what the cloud needs beside the key, and adds the connection only with it', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AddConnectionForm } = await import('./AddConnectionForm')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const added: Array<{ key: string; settings?: Record<string, string> }> = []

    try {
      await act(async () =>
        root.render(
          <AddConnectionForm
            provider={azure}
            onAdded={() => {}}
            onAddApiKey={(_label, key, opts) =>
              added.push({ key, ...(opts?.settings ? { settings: opts.settings } : {}) })
            }
            onAddOAuth={() => {}}
          />,
        ),
      )
      const resource = host.querySelector<HTMLInputElement>(
        'input[aria-label="Azure resource name"]',
      )!
      const key = host.querySelector<HTMLInputElement>('input[type="password"]')!
      const submit = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Add Connection',
      )!
      expect(resource.placeholder).toBe('my-resource')

      await act(async () => type(key, 'az-key'))
      expect(submit.disabled).toBe(true)

      await act(async () => type(resource, '  acme  '))
      expect(submit.disabled).toBe(false)
      await act(async () => submit.click())
      expect(added).toEqual([{ key: 'az-key', settings: { AZURE_RESOURCE_NAME: 'acme' } }])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('switching provider drops what was typed for the previous one', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AddConnectionForm } = await import('./AddConnectionForm')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const added: Array<{ key: string; settings?: Record<string, string> }> = []
    const render = (provider: ProviderEntry) =>
      root.render(
        <AddConnectionForm
          provider={provider}
          onAdded={() => {}}
          onAddApiKey={(_label, key, opts) =>
            added.push({ key, ...(opts?.settings ? { settings: opts.settings } : {}) })
          }
          onAddOAuth={() => {}}
        />,
      )
    const input = (selector: string) => host.querySelector<HTMLInputElement>(selector)!

    try {
      await act(async () => render(azure))
      await act(async () => type(input('input[aria-label="Azure resource name"]'), 'acme'))
      await act(async () => type(input('input[type="password"]'), 'azure-key'))

      await act(async () => render(bedrock))
      expect(input('input[type="password"]').value).toBe('')
      const submit = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Add Connection',
      )!
      expect(submit.disabled).toBe(true)

      await act(async () => type(input('input[aria-label="AWS region"]'), 'eu-west-1'))
      await act(async () => type(input('input[type="password"]'), 'bedrock-key'))
      await act(async () => submit.click())
      expect(added).toEqual([{ key: 'bedrock-key', settings: { AWS_REGION: 'eu-west-1' } }])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
