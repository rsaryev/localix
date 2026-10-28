import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { installReactPerformanceCleanup } from './reactPerformanceCleanup'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

test('real React prop updates keep controls working without retaining performance tracks', async () => {
  const React = await import('react')
  const { act, useState } = React
  const { createRoot } = await import('react-dom/client')
  const { Button } = await import('@localixai/kit/button')
  const original = performance.measure.bind(performance)
  const measured: string[] = []
  performance.measure = function (name, startOrOptions, endMark) {
    const entry = original(name, startOrOptions, endMark)
    if (entry.detail?.devtools?.track === 'Components ⚛') measured.push(name)
    return entry
  }
  const dispose = installReactPerformanceCleanup(performance)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function RenderedMessage({ text }: { text: string }) {
    return <p>{text}</p>
  }
  function StreamingSurface() {
    const [count, setCount] = useState(0)
    return (
      <>
        <Button onClick={() => setCount((value) => value + 1)}>Update {count}</Button>
        <RenderedMessage text={`Update ${count}: ${'message text '.repeat(1_000)}`} />
      </>
    )
  }
  try {
    await act(async () => root.render(<StreamingSurface />))
    for (let index = 0; index < 100; index++) {
      await act(async () => host.querySelector('button')!.click())
    }
    expect(host.querySelector('button')?.textContent).toBe('Update 100')
    expect(measured.length).toBeGreaterThan(100)
    for (const name of new Set(measured)) {
      expect(performance.getEntriesByName(name)).toHaveLength(0)
    }
  } finally {
    await act(async () => root.unmount())
    host.remove()
    dispose()
    performance.measure = original
    for (const name of new Set(measured)) performance.clearMeasures(name)
  }
})
