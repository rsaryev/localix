/** Session E2E: plugin lifecycle — userConfig options and plugin data. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  filesContaining,
  hook,
  manifest,
  optionEnv,
  probe,
  project,
  tokenOf,
  withPlugin,
} from './scenarios-cc-lifecycle-helpers.mjs'

export const CC_LIFECYCLE_OPTION_SCENARIOS = [
  {
    name: 'cc-lifecycle: userConfig options are listed unset at install, a sensitive one is masked, and uninstall deletes the saved values',
    async run(rt) {
      const userConfig = {
        api_url: { type: 'string', title: 'API URL', description: 'Endpoint', required: true },
        api_token: { type: 'string', title: 'Token', description: 'Token', sensitive: true },
      }
      const files = { '.claude-plugin/plugin.json': manifest('lc-cfg', { userConfig }) }
      const field = (record, key) => record.config.find((option) => option.key === key)
      const check = async ({ src }) => {
        // "`userConfig` declares values Claude Code prompts the user for when the plugin is enabled".
        const installed = await rt.api('/plugins/install', { source: src, enable: true })
        assert.equal(field(installed, 'api_url').required, true)
        assert.equal(field(installed, 'api_url').isSet, false)
        assert.ok(installed.validation.warnings.some((w) => w.includes('"api_url" is not set')))
        assert.equal(field(installed, 'api_token').secret, true)

        // "`sensitive` | If `true`, masks input".
        const values = { api_url: 'https://e2e.example', api_token: 'LC-SECRET-1' }
        const saved = await rt.api('/plugins/config', { name: 'lc-cfg', values })
        assert.equal(field(saved, 'api_url').value, 'https://e2e.example')
        assert.equal(field(saved, 'api_token').value, null, 'the secret is never sent back')
        assert.equal(field(saved, 'api_token').isSet, true)

        // "When you uninstall a plugin from the last scope … Claude Code also deletes the plugin's stored options and secrets".
        await rt.api('/plugins/remove', { name: 'lc-cfg' })
        const again = await rt.api('/plugins/install', { source: src, enable: true })
        assert.equal(field(again, 'api_url').isSet, false)
        assert.equal(field(again, 'api_token').isSet, false)
      }
      await withPlugin(rt, 'lc-cfg', files, check, { install: false })
    },
  },
  {
    name: 'cc-lifecycle: a sensitive userConfig value is not stored in plain configuration, and still reaches the hook',
    async run(rt) {
      const home = path.join(rt.root, 'home', '.localix')
      const name = 'lc-secret'
      const env = await optionEnv(rt, name, {
        inspect() {
          // "Sensitive values go to the platform's secure credential store instead" (of `settings.json`).
          const leaks = filesContaining(home, tokenOf(name))
          assert.deepEqual(leaks, [], `plain secret in ${leaks.join(', ')}`)
        },
      })
      // "A shell-form hook reads `$CLAUDE_PLUGIN_OPTION_API_TOKEN` for `api_token`".
      assert.match(env, new RegExp(`^CLAUDE_PLUGIN_OPTION_API_TOKEN=${tokenOf(name)}$`, 'm'), env)
    },
  },
  {
    name: 'cc-lifecycle: every saved userConfig option reaches a hook as CLAUDE_PLUGIN_OPTION_<KEY>',
    async run(rt) {
      // Saved for the user, not a project: "Non-sensitive values are saved under `pluginConfigs`
      // in the user's `settings.json`".
      const env = await optionEnv(rt, 'lc-optenv')
      // "`CLAUDE_PLUGIN_OPTION_<KEY>`: exported to hook processes for every option, with `<KEY>`
      // uppercased. A shell-form hook reads `$CLAUDE_PLUGIN_OPTION_API_TOKEN` for `api_token`".
      assert.match(env, /^CLAUDE_PLUGIN_OPTION_API_URL=https:\/\/opt\.example$/m, env)
      assert.match(env, new RegExp(`^CLAUDE_PLUGIN_OPTION_API_TOKEN=${tokenOf('lc-optenv')}$`, 'm'))
    },
  },
  {
    name: 'cc-lifecycle: a user-scope plugin’s saved options reach its hooks in every project',
    async run(rt) {
      const other = await project(rt, 'lc-proj-opt')
      // "User scope: enabled for you in every project"; "Non-sensitive values are saved under
      // `pluginConfigs` in the user's `settings.json`" — one value for the user, not per project.
      const env = await optionEnv(rt, 'lc-optenv2', { probeIn: other.id })
      assert.match(env, /^CLAUDE_PLUGIN_OPTION_API_URL=https:\/\/opt\.example$/m, env)
      assert.match(
        env,
        new RegExp(`^CLAUDE_PLUGIN_OPTION_API_TOKEN=${tokenOf('lc-optenv2')}$`, 'm'),
      )
    },
  },
  {
    name: 'cc-lifecycle: removing a plugin deletes its ${CLAUDE_PLUGIN_DATA} directory',
    async run(rt) {
      const write =
        'cat >/dev/null; mkdir -p "$CLAUDE_PLUGIN_DATA" && echo kept > "$CLAUDE_PLUGIN_DATA/state"'
      const data = path.join(rt.root, 'home', '.localix', 'plugin-data', 'lc-data')
      await withPlugin(
        rt,
        'lc-data',
        { 'hooks/hooks.json': hook('UserPromptSubmit', write) },
        async ({ say }) => {
          await probe(rt)
          assert.ok(existsSync(path.join(data, 'state')), 'the hook wrote its data')
          assert.equal(await say('/plugin remove lc-data'), 'Removed `lc-data`.')
          // "By default, Claude Code deletes the `${CLAUDE_PLUGIN_DATA}` directory when you uninstall the plugin".
          assert.ok(!existsSync(data), 'the data directory survived the uninstall')
        },
      )
    },
  },
]
