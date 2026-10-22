import { beforeEach, describe, expect, test } from 'bun:test'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { __resetCapabilityRevision, bumpCapabilityRevision } from '../../capabilities/revision'
import { createRunScopeCache } from '../runtime/run-scope'
import { handlePluginsControlCommand } from './command-handlers-plugins'

const session = { id: 'session', projectId: null } as unknown as SessionRecord
const decorativeGlyph = /[\p{Extended_Pictographic}✓✔✕✖✗○]/u

function replyCapture() {
  let text = ''
  return {
    directReply: async (value: string) => {
      text = value
      return {} as MessageMutationResponse
    },
    text: () => text,
  }
}

describe('plugin command system output', () => {
  beforeEach(__resetCapabilityRevision)

  test('reports a successful install without decorative emoji', async () => {
    const reply = replyCapture()
    await handlePluginsControlCommand(
      {
        pluginService: {
          install: async () => ({
            name: 'sample-plugin',
            version: '1.2.3',
            provides: { hasNativeTools: false },
          }),
        },
      } as never,
      'user',
      session,
      '/plugin install owner/review',
      reply.directReply,
    )

    expect(reply.text()).toContain('Installed `sample-plugin` v1.2.3')
    expect(reply.text()).not.toMatch(decorativeGlyph)
  })

  test('reports a failed install without decorative emoji', async () => {
    const reply = replyCapture()
    await handlePluginsControlCommand(
      {
        pluginService: {
          install: async () => {
            throw new Error('manifest missing')
          },
        },
      } as never,
      'user',
      session,
      '/plugin install owner/review',
      reply.directReply,
    )

    expect(reply.text()).toBe('Install failed: manifest missing')
    expect(reply.text()).not.toMatch(decorativeGlyph)
  })

  test('remove says when nothing was installed, and when Claude Code owns the plugin', async () => {
    const run = async (remove: () => Promise<unknown>) => {
      const reply = replyCapture()
      await handlePluginsControlCommand(
        { pluginService: { remove } } as never,
        'user',
        session,
        '/plugin remove review',
        reply.directReply,
      )
      return reply.text()
    }

    expect(
      await run(async () => {
        throw new Error('Plugin "review" is not installed')
      }),
    ).toBe('Remove failed: Plugin "review" is not installed')
    const owned = await run(async () => ({ warnings: [], claudeCodeInstall: 'review@mkt' }))
    expect(owned).not.toContain('Removed')
    expect(owned).toContain('installed by Claude Code')
    expect(owned).toContain('disabled here')
    expect(owned).toContain('claude plugin uninstall review@mkt')
    expect(await run(async () => undefined)).toBe('Removed `review`.')
  })

  /**
   * The mutation's own notification is what invalidates the run-scope cache, and it
   * belongs to the SERVICE — every `createPluginService` mutation fires `deps.onChanged`
   * before returning. The handler used to bump the revision itself, guarded by "…unless
   * the service has a callback", because the chat graph built a second service with no
   * host wiring. With one service per process that branch has nothing left to cover, and
   * a handler that bumped anyway would double-count every toggle.
   */
  test('a slash-command plugin mutation is visible to the next run scope', async () => {
    const reply = replyCapture()
    const scope = { userId: 'user', projectId: '', cwd: '/repo', agentId: 'builtin:localix' }
    const cache = createRunScopeCache<string[]>()
    let enabled = false
    let loads = 0
    const loadTools = async () => {
      loads++
      return enabled ? ['review_tool'] : []
    }

    expect(await cache.resolve(scope, loadTools)).toEqual([])
    await handlePluginsControlCommand(
      {
        // Models the real service: the mutation announces itself.
        pluginService: {
          setEnabled: async () => {
            enabled = true
            bumpCapabilityRevision()
            return { name: 'sample-plugin' }
          },
        },
      } as never,
      'user',
      session,
      '/plugin enable review',
      reply.directReply,
    )

    expect(await cache.resolve(scope, loadTools)).toEqual(['review_tool'])
    expect(loads).toBe(2)
  })

  test('the handler does not announce a mutation the service already announced', async () => {
    const reply = replyCapture()
    const scope = { userId: 'user', projectId: '', cwd: '/repo', agentId: 'builtin:localix' }
    const cache = createRunScopeCache<string[]>()
    let loads = 0
    const loadTools = async () => {
      loads++
      return []
    }

    expect(await cache.resolve(scope, loadTools)).toEqual([])
    // A service that stays SILENT (the shape a bare test stub has): nothing announced,
    // so nothing invalidates. If the handler still bumped on its own, this would reload.
    await handlePluginsControlCommand(
      { pluginService: { setEnabled: async () => ({ name: 'sample-plugin' }) } } as never,
      'user',
      session,
      '/plugin enable review',
      reply.directReply,
    )

    expect(await cache.resolve(scope, loadTools)).toEqual([])
    expect(loads).toBe(1)
  })

  test('an unknown sub-command is told so, instead of silently listing plugins', async () => {
    // A typo used to fall through to the listing, which printed a plugin list and read
    // as if the command had worked.
    const reply = replyCapture()
    await handlePluginsControlCommand(
      { pluginService: {}, buildSessionPluginCatalog: async () => ({ all: [] }) } as never,
      'user',
      session,
      '/plugin disble review',
      reply.directReply,
    )

    expect(reply.text()).toContain('Unknown sub-command `disble`')
    expect(reply.text()).toContain('/plugin disable <name>')
    expect(reply.text()).toContain('/plugin create <what it should do>')
  })

  test('the dropped aliases are gone — one spelling per action', async () => {
    // `uninstall`/`rm` for remove and `upgrade` for update were extra names the menu
    // could never show; accepting them kept two vocabularies alive at once.
    for (const alias of ['uninstall', 'rm', 'upgrade']) {
      const reply = replyCapture()
      let removed = false
      await handlePluginsControlCommand(
        {
          pluginService: {
            remove: async () => {
              removed = true
            },
            update: async () => {
              removed = true
              return { name: 'x', version: '1' }
            },
          },
          buildSessionPluginCatalog: async () => ({ all: [] }),
        } as never,
        'user',
        session,
        `/plugin ${alias} review`,
        reply.directReply,
      )
      expect(removed).toBe(false)
      expect(reply.text()).toContain(`Unknown sub-command \`${alias}\``)
    }
  })

  test('reload rebuilds the user plugins first and reports the ones that failed', async () => {
    const reply = replyCapture()
    let changed = 0
    const report = (ok: boolean) => ({
      ok,
      steps: [{ title: 'UI build', ok, problems: ok ? [] : ['UI build failed: bad import'] }],
    })
    await handlePluginsControlCommand(
      {
        pluginService: {
          authoring: {
            rebuildAll: async () => [
              { name: 'notes', report: report(true) },
              { name: 'timer', report: report(false) },
            ],
          },
          onChanged: () => changed++,
        },
      } as never,
      'user',
      session,
      '/plugin reload',
      reply.directReply,
    )
    expect(changed).toBe(1)
    expect(reply.text()).toContain('Rebuilt `notes`, `timer`.')
    expect(reply.text()).toContain('UI build failed: bad import')
    expect(reply.text()).not.toContain('- UI build: ok')
    expect(reply.text()).not.toMatch(decorativeGlyph)
  })

  test('a bare /plugin still lists, and so does an explicit list', async () => {
    for (const prompt of ['/plugin', '/plugin list']) {
      const reply = replyCapture()
      await handlePluginsControlCommand(
        { pluginService: {}, buildSessionPluginCatalog: async () => ({ all: [] }) } as never,
        'user',
        session,
        prompt,
        reply.directReply,
      )
      expect(reply.text()).toContain('No plugins found')
    }
  })
})
