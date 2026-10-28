import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test'
import { act, type ReactNode } from 'react'
import { useContextRefs } from '@/entities/chat/model/useContextRefs'
import { useVoiceRecorder, type VoiceRecorder } from '@/entities/chat/model/useVoiceRecorder'
import { backendClient } from '@/shared/api/client'
import { registerDom } from '@localixai/kit/testing/dom'
import { useAtRefAutocomplete } from './useAtRefAutocomplete'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
  // The tests put a fake recorder back by assignment, which keeps the key after the original (no
  // recorder at all) is "restored".
  Reflect.deleteProperty(globalThis, 'MediaRecorder')
})

/** Advance the faked clock in small steps, draining the promise chains each fired timer starts,
 *  so a timer re-armed after a fetch settles still comes due inside the same window. */
async function tick(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    jest.advanceTimersByTime(Math.min(50, ms - elapsed))
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
}

/** Module-level, like the real caller's memoized list: a fresh `[]` per render would reset the
 *  debounced preflight timer on every render and the fetch would never fire. */
const NO_AUTOS: never[] = []

/**
 * react-dom is loaded lazily, never at module scope: bun evaluates every test file's module
 * graph before any registration hook runs, so a static import initializes react-dom outside
 * the window in which `registerDom()` has installed happy-dom. A sibling file that did this
 * silently stopped `CommitBox.dom.test.tsx` from receiving React synthetic events at all
 * (see the DOM-test rule in scripts/check-architecture.mjs). Preventive here — this file was not observed to
 * break anything, but it is the same shape.
 */
const reactDom = async () => await import('react-dom/client')

function ComposerDataHarness({ active }: { active: boolean }) {
  useContextRefs(
    '@file:README.md',
    { projectId: 'project-1', sessionId: 'session-1' },
    undefined,
    NO_AUTOS,
    active,
  )
  useAtRefAutocomplete(
    '@resource:',
    () => {},
    'session-1',
    null,
    () => false,
    active,
  )
  return null
}

function ContextRefsHarness() {
  useContextRefs(
    '@file:README.md',
    { projectId: 'project-1', sessionId: 'session-1' },
    undefined,
    NO_AUTOS,
    true,
  )
  return null
}

describe('warm-hidden composer effects', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('defers reference preflight and resource browsing until focused', async () => {
    const originalExpand = backendClient.expandContextRefs.bind(backendClient)
    const originalBrowse = backendClient.browseResources.bind(backendClient)
    let expandCalls = 0
    let browseCalls = 0
    backendClient.expandContextRefs = async () => {
      expandCalls += 1
      return { workingDir: '/workspace', expansions: [] }
    }
    backendClient.browseResources = async (partial) => {
      browseCalls += 1
      return {
        version: 1,
        partial,
        parent: null,
        provider: null,
        segment: '',
        groups: [],
        notices: [],
        total: 0,
        truncated: false,
      }
    }

    const { createRoot } = await reactDom()
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<ComposerDataHarness active={false} />))
      await act(async () => tick(450))
      expect(expandCalls).toBe(0)
      expect(browseCalls).toBe(0)

      await act(async () => root.render(<ComposerDataHarness active />))
      await act(async () => tick(450))
      expect(expandCalls).toBe(1)
      expect(browseCalls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      backendClient.expandContextRefs = originalExpand
      backendClient.browseResources = originalBrowse
    }
  })

  test('a rejected reference preflight settles instead of retrying every debounce window', async () => {
    const originalExpand = backendClient.expandContextRefs.bind(backendClient)
    let expandCalls = 0
    backendClient.expandContextRefs = async () => {
      expandCalls += 1
      throw new Error('invalid reference')
    }

    const { createRoot } = await reactDom()
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<ContextRefsHarness />))
      await act(async () => tick(950))
      expect(expandCalls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      backendClient.expandContextRefs = originalExpand
    }
  })
})

interface RecorderHarnessProps {
  active: boolean
  expose: (recorder: VoiceRecorder) => void
}

function RecorderHarness({ active, expose }: RecorderHarnessProps): ReactNode {
  expose(useVoiceRecorder(active))
  return null
}

describe('warm-hidden voice recorder', () => {
  test('cancels a live recording when its composer loses focus', async () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    const originalMediaRecorder = globalThis.MediaRecorder
    let trackStops = 0
    let recorderStops = 0
    const stream = {
      getTracks: () => [{ stop: () => (trackStops += 1) }],
    } as unknown as MediaStream

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true
      }

      mimeType = 'audio/webm'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: ((event: Event) => void) | null = null

      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

      start() {}

      stop() {
        recorderStops += 1
        this.onstop?.(new Event('stop'))
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    })
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder

    const { createRoot } = await reactDom()
    const root = createRoot(document.createElement('div'))
    let recorder: VoiceRecorder | undefined
    const expose = (next: VoiceRecorder) => {
      recorder = next
    }
    try {
      await act(async () => root.render(<RecorderHarness active expose={expose} />))
      await act(async () => {
        await recorder!.start()
      })
      expect(recorder?.isRecording).toBe(true)

      await act(async () => root.render(<RecorderHarness active={false} expose={expose} />))
      expect(recorder?.isRecording).toBe(false)
      expect(recorderStops).toBe(1)
      expect(trackStops).toBe(1)
    } finally {
      await act(async () => root.unmount())
      globalThis.MediaRecorder = originalMediaRecorder
      if (originalMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      } else {
        Reflect.deleteProperty(navigator, 'mediaDevices')
      }
    }
  })

  test('discards a late microphone grant even after focus returns', async () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    const originalMediaRecorder = globalThis.MediaRecorder
    let resolveStream!: (stream: MediaStream) => void
    let trackStops = 0
    let recorderStarts = 0
    const stream = {
      getTracks: () => [{ stop: () => (trackStops += 1) }],
    } as unknown as MediaStream

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true
      }

      mimeType = 'audio/webm'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: ((event: Event) => void) | null = null

      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

      start() {
        recorderStarts += 1
      }

      stop() {
        this.onstop?.(new Event('stop'))
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            resolveStream = resolve
          }),
      },
    })
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder

    const { createRoot } = await reactDom()
    const root = createRoot(document.createElement('div'))
    let recorder: VoiceRecorder | undefined
    let pendingStart: Promise<void> | undefined
    const expose = (next: VoiceRecorder) => {
      recorder = next
    }
    try {
      await act(async () => root.render(<RecorderHarness active expose={expose} />))
      await act(async () => {
        pendingStart = recorder!.start()
        await Promise.resolve()
      })
      await act(async () => root.render(<RecorderHarness active={false} expose={expose} />))
      await act(async () => root.render(<RecorderHarness active expose={expose} />))
      await act(async () => {
        resolveStream(stream)
        await pendingStart
      })

      expect(recorderStarts).toBe(0)
      expect(trackStops).toBe(1)
      expect(recorder?.isRecording).toBe(false)
    } finally {
      await act(async () => root.unmount())
      globalThis.MediaRecorder = originalMediaRecorder
      if (originalMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      } else {
        Reflect.deleteProperty(navigator, 'mediaDevices')
      }
    }
  })
})
