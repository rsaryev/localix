import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { act } from 'react'
import { SWRConfig } from 'swr'
import { externalAgentsApi } from '../api'
import { useExternalHistory } from './useExternalHistory'
import * as stream from './useHistoryStream'

let teardown: () => Promise<void>
// The live feed is a process-wide socket; these cases are about the query, so it stays closed.
let quiet: { mockRestore(): void }
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  quiet = spyOn(stream, 'useHistoryStream').mockReturnValue(true)
})
afterAll(async () => {
  quiet.mockRestore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const row = (title: string) => ({
  key: `codex:${title}`,
  provider: 'codex' as const,
  nativeSessionId: title,
  title,
  cwd: '/work/app',
  updatedAt: 1,
  sourcePath: `/history/${title}.jsonl`,
  state: 'idle' as const,
  authority: 'none' as const,
})

test('a new search keeps the current rows instead of blanking the list behind a loading line', async () => {
  const providers = spyOn(externalAgentsApi, 'providers').mockResolvedValue([
    { id: 'codex', name: 'Codex', command: 'codex' },
  ])
  let release: () => void = () => {}
  const roster = spyOn(externalAgentsApi, 'roster').mockImplementation(async (query) => {
    if (query.text === 'next') await new Promise<void>((resolve) => (release = resolve))
    return { items: [row(query.text || 'first')], total: 1, withheld: 0 }
  })
  const seen: { loading: boolean; titles: string }[] = []
  function Probe({ text }: { text: string }) {
    const history = useExternalHistory(text)
    seen.push({ loading: history.loading, titles: history.sessions.map((s) => s.title).join() })
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = (text: string) =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe text={text} />
      </SWRConfig>,
    )
  try {
    await act(async () => render(''))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(seen.at(-1)).toEqual({ loading: false, titles: 'first' })
    await act(async () => render('next'))
    expect(seen.at(-1)).toEqual({ loading: false, titles: 'first' })
    await act(async () => release())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(seen.at(-1)).toEqual({ loading: false, titles: 'next' })
  } finally {
    await act(async () => root.unmount())
    providers.mockRestore()
    roster.mockRestore()
  }
})

test('another project reads as loading, not as empty, until its rows arrive', async () => {
  let answerProviders: () => void = () => {}
  const providers = spyOn(externalAgentsApi, 'providers').mockImplementation(
    () =>
      new Promise((resolve) => {
        answerProviders = () => resolve([{ id: 'codex', name: 'Codex', command: 'codex' }])
      }),
  )
  let release: () => void = () => {}
  const asked: (string | undefined)[] = []
  const roster = spyOn(externalAgentsApi, 'roster').mockImplementation(async (query) => {
    asked.push(query.cwdPrefix)
    if (query.cwdPrefix === '/other') await new Promise<void>((resolve) => (release = resolve))
    return {
      items: [{ ...row(query.cwdPrefix ?? 'x'), cwd: query.cwdPrefix }],
      total: 1,
      withheld: 0,
    }
  })
  const seen: { loading: boolean; count: number }[] = []
  function Probe({ cwd }: { cwd: string }) {
    const history = useExternalHistory('', true, { cwd })
    seen.push({ loading: history.loading, count: history.sessions.length })
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const render = (cwd: string) =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe cwd={cwd} />
      </SWRConfig>,
    )
  try {
    await act(async () => render('/work/app'))
    // The roster is asked before the installed list has answered.
    expect(asked).toEqual(['/work/app'])
    await act(async () => answerProviders())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(seen.at(-1)).toEqual({ loading: false, count: 1 })
    await act(async () => render('/other'))
    expect(seen.at(-1)).toEqual({ loading: true, count: 0 })
    await act(async () => release())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(seen.at(-1)).toEqual({ loading: false, count: 1 })
  } finally {
    await act(async () => root.unmount())
    providers.mockRestore()
    roster.mockRestore()
  }
})
