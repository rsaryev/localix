import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { acknowledgeTransferredLayout, waitForTransferredLayout } from './workspaceTransferLayout'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  document.body.replaceChildren()
})

test('only the transferred active panel can acknowledge a hidden window layout', async () => {
  const root = document.createElement('div')
  const panel = document.createElement('div')
  panel.setAttribute('data-work-item-id', 'chat:other')
  root.append(panel)
  document.body.append(root)
  let ready = false
  const mounted = waitForTransferredLayout('chat:moved', 1000).then(() => {
    ready = true
  })
  acknowledgeTransferredLayout(root)
  await Promise.resolve()
  expect(ready).toBe(false)
  panel.setAttribute('data-work-item-id', 'chat:moved')
  panel.hidden = true
  acknowledgeTransferredLayout(root)
  await Promise.resolve()
  expect(ready).toBe(false)
  panel.hidden = false
  root.setAttribute('data-grid-hidden', '')
  acknowledgeTransferredLayout(root)
  await Promise.resolve()
  expect(ready).toBe(false)
  root.removeAttribute('data-grid-hidden')
  acknowledgeTransferredLayout(root)
  await mounted
  expect(ready).toBe(true)
})

test('a missing panel fails within the transfer budget', async () => {
  await expect(waitForTransferredLayout('missing', 1)).rejects.toThrow('did not mount')
})
