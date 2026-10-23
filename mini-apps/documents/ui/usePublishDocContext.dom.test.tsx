import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { usePublishDocContext } from './usePublishDocContext'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

type Published = Parameters<PublishMessageContext>[0]

function Probe(props: { publish?: PublishMessageContext; contextId?: string; label: string }) {
  usePublishDocContext(props.publish, props.contextId, props.label)
  return null
}

const docUri = (id: string) => `localix://resource/doc/${id}`

describe('usePublishDocContext', () => {
  test('clears without an id, then publishes the doc resource and follows its label', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const published: Published[] = []
    const publish: PublishMessageContext = (context) => published.push(context)
    const root = createRoot(document.createElement('div'))

    await act(async () => root.render(<Probe publish={publish} label="a.pdf" />))
    expect(published).toEqual([null])

    await act(async () => root.render(<Probe publish={publish} contextId="doc-1" label="a.pdf" />))
    await act(async () => root.render(<Probe publish={publish} contextId="doc-1" label="b.pdf" />))
    expect(published.slice(1)).toEqual(
      ['a.pdf', 'b.pdf'].map((label) => ({
        strategy: 'replace',
        bindings: [
          {
            kind: 'context',
            source: 'mini-app',
            target: {
              kind: 'resource',
              token: `@resource:${docUri('doc-1')}`,
              label,
              uri: docUri('doc-1'),
            },
          },
        ],
      })),
    )
    await act(async () => root.unmount())
  })

  test('a tab with no publisher publishes nothing and does not throw', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe contextId="doc-1" label="a.pdf" />))
    await act(async () => root.unmount())
  })
})
