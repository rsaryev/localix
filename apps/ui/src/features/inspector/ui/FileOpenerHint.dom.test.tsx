import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { InstallPlan, Listing } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import { compileLikeTheBuild } from '@/testing/reactCompiler'
import { listing } from '@/testing/store'

// The file tab's hint as the desktop build ships it.
compileLikeTheBuild(/features\/inspector\/ui\/FileOpenerHint\.tsx$/)

// Zero-delay timer turns: the poke is delivered with `setTimeout(..., 0)`, then SWR reads.
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
afterEach(() => localStorage.clear())

const documents = listing({
  id: 'documents',
  displayName: 'Documents',
  opens: ['docx', 'pdf', 'csv'],
})

/** A Store that offers Documents for Word files and PDFs, and records what it is asked to do. */
function fakeStore(opts: { needsConsent?: boolean } = {}) {
  const calls: string[] = []
  let installed = false
  const client = {
    openers: async (path: string) => ({
      listings: /\.(docx|pdf|csv)$/.test(path)
        ? [{ ...documents, installs: installed ? [{ scope: 'user', enabled: true }] : [] }]
        : ([] as Listing[]),
    }),
    plan: async () => ({ needsConsent: opts.needsConsent ?? false }) as InstallPlan,
    install: async (ref: { kind: string; id: string }, scope: string) => {
      calls.push(`install ${ref.kind}/${ref.id} ${scope}`)
      installed = true
    },
  } as unknown as StoreClient
  return { client, calls }
}

async function mount(
  path: string,
  client: StoreClient,
  opened: string[] = [],
  opts: { inEditor?: boolean } = {},
) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { FileOpenerHint } = await import('./FileOpenerHint')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (at: string) =>
    act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <FileOpenerHint
            path={at}
            client={client}
            openPackage={(ref) => void opened.push(`${ref.kind}/${ref.id}`)}
            inEditor={opts.inEditor}
          />
        </SWRConfig>,
      )
      await settle()
    })
  await render(path)
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((node) => node.textContent === label) ??
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  return {
    host,
    render,
    click: (label: string) =>
      act(async () => {
        button(label)!.click()
        await settle()
      }),
    done: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('a file nothing here opens names the app that would, and installs it in one click', async () => {
  const { act } = await import('react')
  const { resourceSync } = await import('@/shared/api/resourceSync')
  const store = fakeStore()
  const view = await mount('/work/Report.docx', store.client)
  try {
    expect(view.host.textContent).toContain('Documents opens this file')
    await view.click('Install Documents')
    expect(store.calls).toEqual(['install mini-app/documents user'])
    // The install announces itself; the hint reads again and goes.
    await act(async () => {
      resourceSync.invalidate(['store'])
      await settle()
    })
    expect(view.host.textContent).toBe('')
  } finally {
    await view.done()
  }
})

test('nothing is said for a file no app opens', async () => {
  const view = await mount('/work/notes.txt', fakeStore().client)
  try {
    expect(view.host.textContent).toBe('')
  } finally {
    await view.done()
  }
})

test('one that must ask first opens its Store page instead of installing', async () => {
  const store = fakeStore({ needsConsent: true })
  const opened: string[] = []
  const view = await mount('/work/Report.docx', store.client, opened)
  try {
    await view.click('Install Documents')
    expect(store.calls).toEqual([])
    expect(opened).toEqual(['mini-app/documents'])
  } finally {
    await view.done()
  }
})

test('hidden for Word files, it stays hidden for every Word file but not for a PDF', async () => {
  const view = await mount('/work/Report.docx', fakeStore().client)
  try {
    await view.click('Hide for .docx files')
    expect(view.host.textContent).toBe('')
    await view.render('/work/Other.docx')
    expect(view.host.textContent).toBe('')
    await view.render('/work/scan.pdf')
    expect(view.host.textContent).toContain('Documents opens this file')
  } finally {
    await view.done()
  }
})

test('a file the editor shows offers the app or the editor; Keep in editor is for good', async () => {
  const store = fakeStore()
  const view = await mount('/work/statement.csv', store.client, [], { inEditor: true })
  try {
    expect(view.host.textContent).toContain('Documents opens this file')
    await view.click('Keep in editor')
    expect(store.calls).toEqual([])
    expect(view.host.textContent).toBe('')
    await view.render('/work/other.csv')
    expect(view.host.textContent).toBe('')
  } finally {
    await view.done()
  }
})
