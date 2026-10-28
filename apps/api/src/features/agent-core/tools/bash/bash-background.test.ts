import { describe, expect, test } from 'bun:test'
import { createBashTool } from './bash'
import { FAST_SETTLE } from './testing/test-settle'

describe('bash background settle window', () => {
  test('surfaces early output of a still-running background job in the result', async () => {
    const tool = createBashTool(undefined, undefined, { backgroundSettle: FAST_SETTLE })
    // Prints a line immediately (like a dev server announcing its port), then
    // stays alive — the settle window should capture the early line and return.
    const result = await tool.execute(
      'bg-1',
      { command: 'echo "Local: http://localhost:5174"; sleep 30', background: true },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Local: http://localhost:5174')
    expect(result.content).toContain('still running')
  }, 10_000)

  test('reports a background command that exits immediately as exited early', async () => {
    const tool = createBashTool(undefined, undefined, { backgroundSettle: FAST_SETTLE })
    const result = await tool.execute(
      'bg-2',
      { command: 'echo done; exit 0', background: true },
      undefined,
    )
    expect(result.content).toContain('exited early')
    expect(result.content).toContain('done')
  }, 10_000)

  test('does not mistake an early launcher banner for successful startup', async () => {
    // A minimum grace far longer than the delayed failure, so a loaded machine cannot outlast it;
    // the exit ends the wait at once, so the test still takes only as long as the command.
    const tool = createBashTool(undefined, undefined, {
      backgroundSettle: { minMs: 5_000, maxMs: 6_000, quietMs: 70 },
    })
    // Nested launchers (Tauri, Turbo, package scripts) commonly print their own
    // command first, then fail asynchronously. The old 350 ms quiet-gap return
    // hid this failure from the model until a later turn.
    const result = await tool.execute(
      'bg-delayed-failure',
      {
        command: 'echo "$ tauri dev"; sleep 0.2; echo "beforeDevCommand failed" >&2; exit 1',
        background: true,
      },
      undefined,
    )
    expect(result.content).toContain('exited early (exit 1)')
    expect(result.content).toContain('$ tauri dev')
    expect(result.content).toContain('beforeDevCommand failed')
    expect(result.content).not.toContain('still running')
  }, 10_000)
})
