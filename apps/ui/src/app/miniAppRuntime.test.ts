import { describe, expect, it, spyOn } from 'bun:test'
import {
  miniAppSessions,
  miniAppWorkspace,
  toast as miniAppToast,
} from '@localixai/mini-app-sdk/ui'
import { backendClient } from '@/shared/api/client'
import { composerBus } from '@/shared/lib/composerBus'
import { toast as hostToast } from '@/shared/lib/notify'
import './miniAppRuntime'

describe('mini app UI host notifications', () => {
  it('delegates the SDK toast surface to the shared host notification adapter', () => {
    const error = spyOn(hostToast, 'error').mockReturnValue('host-toast-id')

    try {
      expect(miniAppToast.error('Could not save', { description: 'Try again' })).toBe(
        'host-toast-id',
      )
      expect(error).toHaveBeenCalledWith('Could not save', { description: 'Try again' })
    } finally {
      error.mockRestore()
    }
  })
})

describe('the workspace snapshot a mini app subscribes to', () => {
  it('is referentially stable while nothing changes', () => {
    // `useSyncExternalStore` compares snapshots BY REFERENCE and keeps re-rendering until two reads
    // match. A fresh object literal per call therefore never settles: React gives up and the route
    // falls to its error boundary — "This view could not load", with no clue which surface did it.
    // The unstable version shipped because nothing subscribed through a hook until one did.
    expect(miniAppWorkspace.getSnapshot()).toBe(miniAppWorkspace.getSnapshot())
  })
})

describe('a mini app stopping a session', () => {
  it("hands the messages that were queued behind the run back to that chat's composer", async () => {
    const stop = spyOn(backendClient, 'stop').mockResolvedValue({
      stopped: true,
      returned: [{ content: 'queued while it ran' }],
    })
    const seen: Array<string | undefined> = []
    const off = composerBus.subscribe((request) => {
      if (request.sessionId !== 'mini-app-stopped') return false
      seen.push(request.text)
    })
    try {
      await miniAppSessions.stop('mini-app-stopped')
      expect(seen).toEqual(['queued while it ran'])
    } finally {
      off()
      stop.mockRestore()
    }
  })
})
