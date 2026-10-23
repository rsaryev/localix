import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ContainerStats, ContainerTop } from '../../backend/contracts'
import { StatsPanel, TopPanel } from './ContainerPanels'

const stats: ContainerStats = {
  id: 'container-1',
  cpuPct: 12.5,
  memPct: 25,
  memUsage: '128MiB / 512MiB',
  netIO: '1MB / 2MB',
  netRxBytes: 1_000_000,
  netTxBytes: 2_000_000,
  blockIO: '3MB / 4MB',
  blockReadBytes: 3_000_000,
  blockWriteBytes: 4_000_000,
  pids: 7,
}

const top: ContainerTop = {
  headers: ['PID', 'CMD'],
  processes: [['42', 'node server.js']],
}

// The panels render the host's problem line. The mini app preload binds its double, but the
// combined `bun test mini-apps` run loads no mini app preload, so the suite binds what it renders
// itself — and gives the binding back, so the next mini app's suite meets its own host, not these
// stubs.
let unbindDoubles: () => void
beforeAll(() => {
  unbindDoubles = bindMiniAppUiTestDoubles()
})
afterAll(() => unbindDoubles())

describe('container telemetry panels', () => {
  test('shows a recoverable stats failure instead of an endless sampling state', () => {
    const html = renderToStaticMarkup(
      <StatsPanel
        container="web-1"
        stats={null}
        history={[]}
        running
        error={{ message: 'Docker stats timed out.' }}
        onRetry={() => {}}
      />,
    )

    // One problem: the daemon's sentence IS the headline.
    expect(html).toContain('Docker stats timed out.')
    expect(html).toContain('>Retry<')
    expect(html).not.toContain('Sampling stats')
  })

  test('keeps the last stats snapshot visible when a refresh fails', () => {
    const html = renderToStaticMarkup(
      <StatsPanel
        container="web-1"
        stats={stats}
        history={[]}
        running
        error={{ message: 'Docker stats timed out.' }}
        onRetry={() => {}}
      />,
    )

    expect(html).toContain('Docker stats timed out.')
    expect(html).toContain('12.50%')
    expect(html).toContain('Details')
  })

  test('distinguishes process failures from an in-progress request', () => {
    const html = renderToStaticMarkup(
      <TopPanel
        container="web-1"
        top={null}
        running
        error={{ message: 'Docker top is unavailable.' }}
        onRetry={() => {}}
      />,
    )

    expect(html).toContain('Docker top is unavailable.')
    expect(html).toContain('>Retry<')
    expect(html).not.toContain('Reading processes')
  })

  test('retains the process table through a transient refresh failure', () => {
    const html = renderToStaticMarkup(
      <TopPanel
        container="web-1"
        top={top}
        running
        error={{ message: 'Docker top is unavailable.' }}
        onRetry={() => {}}
      />,
    )

    expect(html).toContain('Docker top is unavailable.')
    expect(html).toContain('node server.js')
    expect(html).toContain('Details')
  })
})
