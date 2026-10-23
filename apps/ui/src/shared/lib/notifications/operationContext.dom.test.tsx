import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { runAsBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'
import { activeEventOrigin, setActiveEventRoute } from './context'
import { observeOperationContext, resetOperationContextsForTests } from './operationContext'
import { recentUserIntent, resetUserIntentForTests, startUserIntentCapture } from './userIntent'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(() => teardown())

beforeEach(() => {
  document.body.replaceChildren()
  resetOperationContextsForTests()
  resetUserIntentForTests()
  setActiveEventRoute('/project/project-1/LOCALIX-18')
})

afterEach(() => {
  document.body.replaceChildren()
  resetOperationContextsForTests()
  resetUserIntentForTests()
})

describe('automatic operation context', () => {
  it('captures only an accessible control identity and never its field value or surrounding text', () => {
    const stop = startUserIntentCapture()
    const button = document.createElement('button')
    button.setAttribute('aria-label', '  Retry   agent run  ')
    button.textContent = 'private visible copy'
    document.body.append(button)
    button.click()

    expect(recentUserIntent()).toMatchObject({
      kind: 'click',
      control: 'button:Retry agent run',
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: 'project-1' },
    })
    expect(JSON.stringify(recentUserIntent())).not.toContain('private visible copy')

    const input = document.createElement('input')
    input.value = 'secret field value'
    document.body.append(input)
    input.click()
    expect(JSON.stringify(recentUserIntent())).not.toContain('secret field value')
    expect(recentUserIntent(Date.now() + 2_001)).toBeNull()
    stop()
  })

  // A poll's tick inside the two-second window after a click was filed as the person's action,
  // raising "Could not load the data" rows for a Kubernetes poll nobody had asked for.
  it('a request started by a timer is not credited to the click before it', () => {
    const stop = startUserIntentCapture()
    const button = document.createElement('button')
    button.setAttribute('aria-label', 'Containers')
    document.body.append(button)
    button.click()
    const origin = activeEventOrigin()
    const polled = runAsBackgroundWork(() =>
      observeOperationContext({ traceId: 'poll', phase: 'started', ts: Date.now(), origin }),
    )
    expect(polled.intent).toBeNull()
    const clicked = observeOperationContext({
      traceId: 'click',
      phase: 'started',
      ts: Date.now(),
      origin,
    })
    expect(clicked.intent?.control).toBe('button:Containers')
    stop()
  })

  it('ignores clicks outside actionable controls', () => {
    const stop = startUserIntentCapture()
    const copy = document.createElement('p')
    copy.textContent = 'Read-only content'
    document.body.append(copy)
    copy.click()
    expect(recentUserIntent()).toBeNull()
    stop()
  })

  it('pins the initiating session even when the route changes before failure', () => {
    const started = observeOperationContext({
      traceId: 'h1',
      phase: 'started',
      ts: Date.now(),
      origin: activeEventOrigin(),
    })
    setActiveEventRoute('/project/PRJ-1/LOCALIX-19')
    const failed = observeOperationContext({
      traceId: 'h1',
      phase: 'failed',
      ts: Date.now() + 1,
      origin: activeEventOrigin(),
    })

    expect(started.origin).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-18',
      projectId: 'project-1',
    })
    expect(failed.origin).toEqual(started.origin)

    const unrelated = observeOperationContext({
      traceId: 'h1',
      phase: 'failed',
      ts: Date.now() + 2,
      origin: activeEventOrigin(),
    })
    expect(unrelated.origin).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-19',
      projectId: 'PRJ-1',
    })
  })

  it('does not attach one session click to another session or application operation', () => {
    const stop = startUserIntentCapture()
    const button = document.createElement('button')
    button.setAttribute('aria-label', 'Retry run')
    document.body.append(button)
    button.click()

    const otherSession = observeOperationContext({
      traceId: 'q-other',
      phase: 'started',
      ts: Date.now(),
      origin: { kind: 'session', sessionId: 'LOCALIX-19', projectId: 'project-1' },
    })
    const application = observeOperationContext({
      traceId: 'h-application',
      phase: 'started',
      ts: Date.now(),
      origin: { kind: 'application' },
    })

    expect(otherSession.intent).toBeNull()
    expect(application.intent).toBeNull()
    stop()
  })
})
