import { describe, expect, test } from 'bun:test'

import { ConflictError } from '../../../lib/domain-errors'
import type { PluginRecord } from '../../plugins/contracts'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handlePluginsControlCommand } from './command-handlers-plugins'
import { installReply } from './command-handlers-plugins-replies'

const session = { id: 'session', projectId: null } as unknown as SessionRecord

async function say(pluginService: unknown, prompt: string): Promise<string> {
  let text = ''
  await handlePluginsControlCommand(
    { pluginService } as never,
    'user',
    session,
    prompt,
    async (value: string) => {
      text = value
      return {} as MessageMutationResponse
    },
  )
  return text
}

const record = (extra: Partial<PluginRecord>) =>
  ({
    name: 'top',
    version: '1.0.0',
    scope: 'global',
    dir: '/home/.localix/plugins/top',
    enabled: true,
    provides: {},
    ...extra,
  }) as PluginRecord

describe('plugin command replies', () => {
  test('an install names its dependencies, and says enabled only when it is', () => {
    // "The success message lists them."
    expect(installReply(record({ installedDependencies: ['base'] }))).toBe(
      'Installed `top` v1.0.0 for all chats (`/home/.localix/plugins/top`) and enabled it. Also installed and enabled: `base`. Start a new turn to use it.',
    )
    // "Such a plugin is installed but stays off until you turn it on."
    const off = installReply(record({ enabled: false }))
    expect(off).not.toContain('enabled it')
    expect(off).toContain('run `/plugin enable top`')
  })

  test('a plugin loading in place says where edits take effect, on install and on update', async () => {
    // loading.md: "Your edits to the source directory take effect at the next session start or
    // `/reload-plugins`, and you don't need to increase the version".
    const inPlace = record({ dir: '/src/market/plugins/top', loadsInPlace: true })
    expect(installReply(inPlace)).toContain('It loads in place from that folder')
    const update = async () => inPlace
    expect(await say({ update }, '/plugin update top')).toBe(
      '`top` v1.0.0 loads in place from `/src/market/plugins/top` and its files check out. Edits there take effect at `/plugin reload`; it needs no update.',
    )
    expect(await say({ update: async () => record({}) }, '/plugin update top')).toStartWith(
      'Updated `top` to v1.0.0.',
    )
  })

  test('a switch or install that changes nothing is said plainly, not as a failure', async () => {
    const already = (code: string, message: string) => async () => {
      throw new ConflictError(code, message)
    }
    expect(
      await say(
        { setEnabled: already('plugin_already_in_state', 'Plugin "top" is already enabled') },
        '/plugin enable top',
      ),
    ).toBe('Plugin "top" is already enabled.')
    expect(
      await say(
        {
          install: already(
            'plugin_already_installed',
            'Plugin "top" is already installed (scope: user)',
          ),
        },
        '/plugin install /src/top',
      ),
    ).toBe('Plugin "top" is already installed (scope: user).')
  })

  test('/plugin validate <path> validates the folder and prints a verdict line', async () => {
    let asked = ''
    const validatePath = async (dir: string) => {
      asked = dir
      return { name: 'top', validation: { errors: [], warnings: ['Unknown field "x"'] } }
    }
    const report = await say({ validatePath }, '/plugin validate /src/top')
    expect(asked).toBe('/src/top')
    expect(report).toContain('- `top` — 0 error(s), 1 warning(s)')
    expect(report).toContain('    - Warning: Unknown field "x"')
    expect(report.split('\n').at(-1)).toBe('Validation passed with warnings')
    const strict = await say({ validatePath }, '/plugin validate /src/top --strict')
    expect(strict).toContain('- `top` — 1 error(s), 0 warning(s)')
    expect(strict.split('\n').at(-1)).toBe('Validation failed (--strict treats warnings as errors)')
  })

  test('an update whose computed version did not change says so in Claude Code’s words', async () => {
    // loading.md: "`<name> is already at the latest version (<version>).`"
    expect(
      await say({ update: async () => record({ upToDate: true }) }, '/plugin update top'),
    ).toBe('`top` is already at the latest version (1.0.0).')
  })
})
