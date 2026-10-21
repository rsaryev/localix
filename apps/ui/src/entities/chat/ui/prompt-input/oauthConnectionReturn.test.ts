import { describe, expect, test } from 'bun:test'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'
import { subscribeModelPicker } from '@/shared/lib/modelPickerBus'
import { returnToOAuthModels } from './oauthConnectionReturn'

describe('OAuth return to models', () => {
  test('opens the originating session with the exact connection before focusing the app', () => {
    const events: unknown[] = []
    const unsubscribe = subscribeModelPicker((request) => events.push(request))
    const restore = configurePlatformCapabilities({
      desktop: {
        invoke: <T>(command: string) => {
          events.push(command)
          return Promise.resolve(undefined as T)
        },
      },
    })
    try {
      returnToOAuthModels({ id: 'work-openai', providerId: 'openai' }, 'session-1')
      expect(events).toEqual([
        { sessionId: 'session-1', providerId: 'openai', connectionId: 'work-openai' },
        'focus_app',
      ])
    } finally {
      unsubscribe()
      restore()
    }
  })

  test('a setup connection brings the app back without routing an unrelated conversation', () => {
    const requests: unknown[] = []
    const commands: string[] = []
    const unsubscribe = subscribeModelPicker((request) => requests.push(request))
    const restore = configurePlatformCapabilities({
      desktop: {
        invoke: (command) => {
          commands.push(command)
          return null
        },
      },
    })
    try {
      returnToOAuthModels({ id: 'copilot-1', providerId: 'github-copilot' }, null)
      expect(requests).toEqual([])
      expect(commands).toEqual(['focus_app'])
    } finally {
      unsubscribe()
      restore()
    }
  })
})
