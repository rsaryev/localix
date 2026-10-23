import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { backendClient, registerDom } from '@localixai/kit/testing'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

type Published = Parameters<PublishMessageContext>[0]

/** Extraction that resolves only when the test says so, so no step waits on a timer. */
async function deferredExtract() {
  const { documentsApi } = await import('./api/documentsApi')
  let resolve!: (id: string) => void
  const pending = new Promise<string>((done) => (resolve = done))
  const spy = spyOn(documentsApi, 'extract').mockImplementation(
    async () => ({ id: await pending }) as never,
  )
  restores.push(() => spy.mockRestore())
  return { resolve, pending }
}

/** A PDF read past the preview cap: the tab shows its notice instead of loading an iframe. */
function stubTooLargeRead() {
  const spy = spyOn(backendClient, 'getFileContent').mockImplementation(async (_session, path) => ({
    path,
    content: '',
    bytes: 0,
    truncated: true,
  }))
  restores.push(() => spy.mockRestore())
}

async function stubIngest() {
  const { tableApi } = await import('./api/tableApi')
  const meta = { id: 'table-1', title: 'Sheet', columns: [], rowCount: 0, view: 'table' }
  for (const spy of [
    spyOn(tableApi, 'ingest').mockResolvedValue(meta as never),
    spyOn(tableApi, 'getMeta').mockResolvedValue(meta as never),
    spyOn(tableApi, 'getRows').mockResolvedValue({ rows: [], total: 0, offset: 0, limit: 500 }),
    spyOn(tableApi, 'openTargets').mockResolvedValue({ targets: [] }),
  ])
    restores.push(() => spy.mockRestore())
}

const docBinding = (id: string, label: string): Published => ({
  strategy: 'replace',
  bindings: [
    {
      kind: 'context',
      source: 'mini-app',
      target: {
        kind: 'resource',
        token: `@resource:localix://resource/doc/${id}`,
        label,
        uri: `localix://resource/doc/${id}`,
      },
    },
  ],
})

describe('a document file tab publishes its extracted doc resource', () => {
  test.each([
    ['PdfFileTab', '/repo/report.pdf'],
    ['TableFileTab', '/repo/data.xlsx'],
  ] as const)(
    '%s publishes nothing until extraction names the doc, then that resource',
    async (tab, path) => {
      const { act } = await import('react')
      const { createRoot } = await import('react-dom/client')
      const extract = await deferredExtract()
      await stubIngest()
      stubTooLargeRead()
      const { PdfFileTab } = await import('./PdfFileTab')
      const { TableFileTab } = await import('./TableFileTab')
      const Tab = tab === 'PdfFileTab' ? PdfFileTab : TableFileTab
      const published: Published[] = []
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      try {
        await act(async () =>
          root.render(
            <Tab
              path={path}
              sessionId="session-1"
              publishMessageContext={(context) => published.push(context)}
            />,
          ),
        )
        expect(published).toEqual([null])
        await act(async () => {
          extract.resolve('doc-7')
          await extract.pending
        })
        expect(published.at(-1)).toEqual(docBinding('doc-7', path.slice('/repo/'.length)))
      } finally {
        await act(async () => root.unmount())
        host.remove()
      }
    },
  )
})
