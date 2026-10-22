/** Session E2E: plugin lifecycle — install, enable, disable, remove and validate. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { script } from './scenario-helpers.mjs'
import { writeTree } from './scenarios-cc-helpers.mjs'
import {
  BAD_OPTION,
  MCP_SERVER,
  PARTS_AGENT_BODY,
  PARTS_MCP_TOOLS,
  chat,
  hook,
  manifest,
  partsTurn,
  pluginsDir,
  probe,
  skill,
  withMarket,
  withPlugin,
} from './scenarios-cc-lifecycle-helpers.mjs'

export const CC_LIFECYCLE_INSTALL_SCENARIOS = [
  {
    name: 'cc-lifecycle: a local plugin installs for all chats, shows in list and details, and remove deletes it; an unknown name is not found',
    async run(rt) {
      const files = { 'skills/basic-skill/SKILL.md': skill('basic-skill', 'LC-BASIC-SKILL') }
      await withPlugin(rt, 'lc-basic', files, async ({ say, installed }) => {
        // "Defaults to `user`"; "Installing a plugin also enables it".
        assert.match(installed, /^Installed `lc-basic` v1\.0\.0 for all chats .* and enabled it\./)
        // "List installed plugins with their version, scope, and status."
        assert.match(await say('/plugin list'), /- enabled `lc-basic` _\(global\)_ — 1 skills/)
        // "Claude Code prints the plugin's name, version, description, and source".
        const details = await say('/plugin details lc-basic')
        assert.match(details, /\*\*lc-basic\*\* v1\.0\.0 — lc-basic plugin/)
        assert.match(details, /\*\*Enabled:\*\* yes/)
        assert.ok(
          (await probe(rt)).system.includes('LC-BASIC-SKILL'),
          'the skill reaches the model',
        )

        // "Remove an installed plugin from one scope."
        assert.equal(await say('/plugin remove lc-basic'), 'Removed `lc-basic`.')
        assert.ok(!existsSync(path.join(pluginsDir(rt), 'lc-basic')), 'its files are deleted')
        assert.ok(!(await probe(rt)).system.includes('LC-BASIC-SKILL'), 'the skill is gone')
        // "For a plugin that isn't loaded, Claude Code prints … not found".
        assert.equal(await say('/plugin details lc-basic'), 'No plugin named `lc-basic`.')
        // "When the plugin isn't installed at that scope, the command prints … Failed to uninstall".
        assert.match(
          await say('/plugin remove lc-basic'),
          /^Remove failed: .*"lc-basic" is not installed/,
        )
        const unknown = await rt.call('/plugins/remove', { name: 'lc-never-installed' })
        assert.equal(unknown.status, 404)
        assert.equal(unknown.body.error.code, 'plugin_not_found')
      })
    },
  },
  {
    name: 'cc-lifecycle: disable takes a plugin’s skill, agent, command, MCP server and hook out of the next turn; enable and reload bring them back',
    async run(rt) {
      const log = path.join(rt.root, 'lc-parts-hook.log')
      const files = {
        'skills/parts-skill/SKILL.md': skill('parts-skill', 'LC-PARTS-SKILL'),
        'agents/parts-agent.md': `---\nname: parts-agent\ndescription: Checks parts\n---\n\n${PARTS_AGENT_BODY}\n`,
        'commands/parts-cmd.md': '---\ndescription: Parts command\n---\n\nLC-PARTS-COMMAND-BODY\n',
        'hooks/hooks.json': hook('UserPromptSubmit', `cat >> "${log}"; echo >> "${log}"`),
        '.mcp.json': JSON.stringify({
          mcpServers: { lcparts: { command: 'python3', args: ['${CLAUDE_PLUGIN_ROOT}/mcp.py'] } },
        }),
        'mcp.py': MCP_SERVER,
      }
      const hookSaw = () => existsSync(log) && readFileSync(log, 'utf8').includes('Probe.')
      const runCommand = async () => {
        const session = await rt.createSession({ title: 'Command' })
        const prompt = `/lc-parts:parts-cmd go ${script({ localix: ['Ran.'] })}`
        const after = await rt.say(session.id, prompt)
        const read = rt.requests({ session: after }).flatMap((r) => r.messages.map((m) => m.text))
        return {
          reply: rt.transcript(after).at(-1).text,
          ran: read.some((text) => text.includes('LC-PARTS-COMMAND-BODY')),
        }
      }
      // The plugin's own parts by name, so another plugin's agent or server cannot stand in.
      const loaded = async () => {
        const { last, agentRan } = await partsTurn(rt)
        return {
          skill: last.system.includes('LC-PARTS-SKILL'),
          agent: agentRan,
          mcp: PARTS_MCP_TOOLS.some((name) => last.tools.includes(name)),
          hook: hookSaw(),
        }
      }
      await withPlugin(rt, 'lc-parts', files, async ({ say }) => {
        const all = { skill: true, agent: true, mcp: true, hook: true }
        assert.deepEqual(await loaded(), all)
        assert.ok((await runCommand()).ran, 'the command expanded')

        // "Disable a plugin without uninstalling it." — its components leave the session.
        assert.equal(
          await say('/plugin disable lc-parts'),
          'Disabled `lc-parts`. Start a new turn for it to take effect.',
        )
        assert.match(await say('/plugin list'), /- disabled `lc-parts` _\(global\)_/)
        writeFileSync(log, '')
        const none = { skill: false, agent: false, mcp: false, hook: false }
        assert.deepEqual(await loaded(), none)
        const command = await runCommand()
        assert.ok(!command.ran, 'the command is gone')
        assert.match(command.reply, /Unknown slash command `\/lc-parts:parts-cmd`/)

        // "Enable a disabled plugin."
        assert.equal(
          await say('/plugin enable lc-parts'),
          'Enabled `lc-parts`. Start a new turn for it to take effect.',
        )
        assert.deepEqual(await loaded(), all)

        // /reload-plugins: "Pending changes are plugins you … edited on disk since the session started."
        const installed = path.join(pluginsDir(rt), 'lc-parts/skills/parts-skill/SKILL.md')
        writeFileSync(installed, skill('parts-skill', 'LC-PARTS-SKILL-EDITED'))
        assert.match(await say('/plugin reload'), /^Plugins reloaded\./)
        assert.ok((await probe(rt)).system.includes('LC-PARTS-SKILL-EDITED'), 'the edit loads')
      })
    },
  },
  {
    name: 'cc-lifecycle: an install, disable or enable that changes nothing says the plugin already is',
    async run(rt) {
      await withMarket(rt, 'lc-twice', { 'mk-twice': {} }, async ({ say }) => {
        assert.match(await say('/plugin install mk-twice@lc-twice'), /^Installed `mk-twice`/)
        // "Already installed at that scope: the output is `Plugin "formatter@my-marketplace" is
        // already installed (scope: project)` and the exit code is `0`"; the scope "Defaults to `user`".
        assert.match(
          await say('/plugin install mk-twice@lc-twice'),
          /^Plugin "mk-twice(@lc-twice)?" is already installed \(scope: user\)/,
        )
        assert.match(await say('/plugin disable mk-twice'), /^Disabled `mk-twice`/)
        // "Disabling a plugin that is already disabled prints `Plugin "formatter" is already disabled`".
        assert.match(
          await say('/plugin disable mk-twice'),
          /^Plugin "mk-twice" is already disabled/,
        )
        assert.match(await say('/plugin details mk-twice'), /\*\*Enabled:\*\* no/)
        assert.match(await say('/plugin enable mk-twice'), /^Enabled `mk-twice`/)
        // "If the plugin is already enabled … prints `Plugin "formatter" is already enabled`".
        assert.match(await say('/plugin enable mk-twice'), /^Plugin "mk-twice" is already enabled/)
        assert.match(await say('/plugin details mk-twice'), /\*\*Enabled:\*\* yes/)
      })
    },
  },
  {
    name: 'cc-lifecycle: /plugin validate <path> passes a clean plugin, passes an unknown field with warnings, fails it under --strict, and fails a bad userConfig key',
    async run(rt) {
      // Each folder is named after its plugin, as `claude plugin init` lays one out.
      const at = (plugin) => {
        const dir = path.join(rt.root, 'validate', plugin.name)
        writeTree(dir, { '.claude-plugin/plugin.json': JSON.stringify(plugin) })
        return dir
      }
      const author = { name: 'E2E' }
      const clean = at(JSON.parse(manifest('lc-clean', { author })))
      const warn = at({ name: 'lc-warn', frobnicate: 1 })
      const bad = at(JSON.parse(manifest('lc-badcfg', { userConfig: BAD_OPTION })))
      const { say } = await chat(rt)
      // "/plugin validate <path> | Prints the same report as `claude plugin validate`, inline";
      // "Claude Code prints the file it validated, any errors and warnings with their paths, and a
      // verdict line": "`Validation passed` or `Validation passed with warnings`" (exit 0),
      // "`Validation failed` or `Validation failed (--strict treats warnings as errors)`" (exit 1).
      assert.match(await say(`/plugin validate ${clean}`), /^Validation passed$/m)
      // "`Validation passed with warnings`: … an unknown top-level field that Claude Code strips,
      // … or a missing `version`, `description`, or `author`".
      const report = await say(`/plugin validate ${warn}`)
      assert.match(report, /^Validation passed with warnings$/m)
      assert.match(report, /frobnicate/)
      assert.match(report, /description/)
      // "Pass `--strict` to turn warnings into failures".
      const strict = await say(`/plugin validate ${warn} --strict`)
      assert.match(strict, /^Validation failed \(--strict treats warnings as errors\)$/m)
      assert.match(strict, /frobnicate/)
      // "`Validation failed`: … an unknown key inside a `userConfig` option".
      const failed = await say(`/plugin validate ${bad}`)
      assert.match(failed, /^Validation failed$/m)
      assert.match(failed, /bogus/)
    },
  },
  {
    name: 'cc-lifecycle: a plugin whose userConfig option has an unknown key does not load',
    async run(rt) {
      const files = {
        '.claude-plugin/plugin.json': manifest('lc-strictcfg', { userConfig: BAD_OPTION }),
        'skills/strict-skill/SKILL.md': skill('strict-skill', 'LC-STRICTCFG-SKILL'),
      }
      await withPlugin(rt, 'lc-strictcfg', files, async () => {
        // "`userConfig` options … are strict. An unknown key inside one is an error, and the plugin doesn't load".
        assert.ok(!(await probe(rt)).system.includes('LC-STRICTCFG-SKILL'), 'the plugin loaded')
      })
    },
  },
]
