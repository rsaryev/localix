import { beforeEach, describe, expect, it } from 'bun:test'
import { setActiveEventRoute } from './context'
import { desktopInvokeFailureNeedsFallback, desktopInvokeTraceStep } from './desktopInstrumentation'
import type { ObservedOperationContext } from './operationContext'

beforeEach(() => setActiveEventRoute('/project/project-1/LOCALIX-18'))

const origin = {
  kind: 'session' as const,
  sessionId: 'LOCALIX-18',
  projectId: 'project-1',
}
const userContext: ObservedOperationContext = {
  origin,
  intent: { ts: 990, kind: 'click', control: 'button:Install update', origin },
}

describe('automatic desktop bridge tracing', () => {
  it('captures user commands with safe metadata and no arguments or error message', () => {
    const event = {
      traceId: 'native-1',
      command: 'updater_install',
      phase: 'failed' as const,
      ts: 1_000,
      durationMs: 8,
      error: Object.assign(new Error('private native detail'), { code: 'offline' }),
    }
    const step = desktopInvokeTraceStep(event, userContext)

    expect(step).toMatchObject({
      traceId: 'native-1',
      phase: 'failed',
      kind: 'desktop.updater_install',
      origin,
      attributes: {
        command: 'updater_install',
        initiatedBy: 'user',
        interactionControl: 'button:Install update',
        errorType: 'Error',
        code: 'offline',
      },
    })
    expect(JSON.stringify(step)).not.toContain('private native detail')
    expect(desktopInvokeFailureNeedsFallback(event, userContext)).toBeTrue()
  })

  it('keeps background success quiet and commands with explicit fallbacks non-incident', () => {
    expect(
      desktopInvokeTraceStep({
        traceId: 'native-2',
        command: 'set_title',
        phase: 'succeeded',
        ts: 1_000,
      }),
    ).toBeNull()
    expect(
      desktopInvokeFailureNeedsFallback(
        {
          traceId: 'native-3',
          command: 'pick_directory',
          phase: 'failed',
          ts: 1_000,
        },
        userContext,
      ),
    ).toBeFalse()
  })

  it('redacts malformed command names instead of treating them as incident labels', () => {
    const event = {
      traceId: 'native-4',
      command: 'token=secret',
      phase: 'failed' as const,
      ts: 1_000,
    }
    expect(desktopInvokeTraceStep(event, userContext)).toMatchObject({
      kind: 'desktop.unknown',
      attributes: { command: 'unknown' },
    })
    expect(desktopInvokeFailureNeedsFallback(event, userContext)).toBeFalse()
  })

  it('keeps optional drag preparation and receiver cancellation from reporting a second incident', () => {
    for (const command of [
      'workspace_drag_prepare',
      'workspace_drag_cancel',
      'workspace_transfer_presented',
      'workspace_transfer_ready',
    ]) {
      const event = { traceId: 'native-drag', command, phase: 'failed' as const, ts: 1_000 }
      expect(desktopInvokeTraceStep(event, userContext)?.kind).toBe(`desktop.${command}`)
      expect(desktopInvokeFailureNeedsFallback(event, userContext)).toBeFalse()
    }
    expect(
      desktopInvokeFailureNeedsFallback(
        { traceId: 'native-move', command: 'workspace_drag_commit', phase: 'failed', ts: 1_000 },
        userContext,
      ),
    ).toBeTrue()
  })
})
