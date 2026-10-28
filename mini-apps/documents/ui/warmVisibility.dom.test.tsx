import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { backendClient, registerDom } from '@localixai/kit/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => turns()

describe('warm-hidden Documents data sources', () => {
  test('extraction, file reads, ingestion, and table paging wait for selection', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { documentsApi } = await import('./api/documentsApi')
    const { tableApi } = await import('./api/tableApi')
    const { DocumentFileTab } = await import('./DocumentFileTab')
    const { PdfFileTab } = await import('./PdfFileTab')
    const { TableFileTab } = await import('./TableFileTab')
    const fileRead = spyOn(backendClient, 'getFileContent').mockImplementation(
      async (_sessionId, path) => ({
        path,
        content: '',
        bytes: 0,
        truncated: false,
      }),
    )

    const extract = spyOn(documentsApi, 'extract').mockResolvedValue({
      id: 'document-cache.json',
      document: {
        kind: 'text',
        markdown: 'Hello',
        metadata: {},
      },
    } as never)
    const ingest = spyOn(tableApi, 'ingest').mockResolvedValue({
      id: 'table-1',
      title: 'Sheet',
      columns: [],
      rowCount: 0,
      view: 'table',
    } as never)
    const meta = spyOn(tableApi, 'getMeta').mockResolvedValue({
      id: 'table-1',
      title: 'Sheet',
      columns: [],
      rowCount: 0,
      view: 'table',
    } as never)
    const rows = spyOn(tableApi, 'getRows').mockResolvedValue({
      rows: [],
      total: 0,
      offset: 0,
      limit: 500,
    })
    const targets = spyOn(tableApi, 'openTargets').mockResolvedValue({ targets: [] })

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <DocumentFileTab path="/repo/note.docx" />
          <PdfFileTab path="/repo/report.pdf" sessionId="session-1" />
          <TableFileTab path="/repo/data.xlsx" sessionId="session-1" />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(extract).toHaveBeenCalledTimes(0)
    expect(fileRead).toHaveBeenCalledTimes(0)
    expect(ingest).toHaveBeenCalledTimes(0)
    expect(meta).toHaveBeenCalledTimes(0)
    expect(rows).toHaveBeenCalledTimes(0)
    expect(targets).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    // Each specialised viewer resolves its own stable `localix://resource/doc/` context identity:
    // Office, PDF, and spreadsheet. All three waited for visibility.
    expect(extract).toHaveBeenCalledTimes(3)
    expect(fileRead).toHaveBeenCalledTimes(1)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(meta).toHaveBeenCalledTimes(1)
    expect(rows).toHaveBeenCalledTimes(1)
    expect(targets).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<Surface visible={false} />))
    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(extract).toHaveBeenCalledTimes(3)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(fileRead).toHaveBeenCalledTimes(2)
    expect(meta).toHaveBeenCalledTimes(2)
    expect(rows).toHaveBeenCalledTimes(2)
    expect(targets).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    extract.mockRestore()
    ingest.mockRestore()
    meta.mockRestore()
    rows.mockRestore()
    targets.mockRestore()
    fileRead.mockRestore()
  })
})
