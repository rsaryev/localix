/** Session E2E: plugin lifecycle — scopes, the list, Claude Code installs and hosted marketplaces. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { writeTree } from './scenarios-cc-helpers.mjs'
import {
  chat,
  cleanup,
  manifest,
  probe,
  skill,
  withMarket,
  withPlugin,
} from './scenarios-cc-lifecycle-helpers.mjs'

export const CC_LIFECYCLE_SCOPE_SCENARIOS = [
  {
    name: 'cc-lifecycle: a project-scope install loads only in that project’s chats, a user-scope one in every project',
    async run(rt) {
      const dirA = path.join(rt.root, 'proj-a')
      const projectA = await rt.api('/projects', { name: 'lc-proj-a', workingDir: dirA })
      const dirB = path.join(rt.root, 'proj-b')
      const projectB = await rt.api('/projects', { name: 'lc-proj-b', workingDir: dirB })
      const scoped = path.join(rt.root, 'src-lc-scoped')
      writeTree(scoped, {
        '.claude-plugin/plugin.json': manifest('lc-scoped'),
        'skills/s/SKILL.md': skill('s', 'LC-SCOPED-SKILL'),
      })
      const inA = await chat(rt, { projectId: projectA.id })
      const files = { 'skills/u/SKILL.md': skill('u', 'LC-USER-SKILL') }
      await withPlugin(rt, 'lc-user', files, async ({ say, installed }) => {
        // "Project scope: enabled for everyone who works in this repository"; "User scope: … in every project".
        assert.match(installed, /for all chats/)
        const local = await inA.say(`/plugin install ${scoped} --project`)
        assert.match(local, /^Installed `lc-scoped` v1\.0\.0 for this project /)
        assert.ok(existsSync(path.join(dirA, '.localix', 'plugins', 'lc-scoped')))
        assert.match(await inA.say('/plugin list'), /- enabled `lc-scoped` _\(project\)_/)

        const a = await probe(rt, { projectId: projectA.id })
        const b = await probe(rt, { projectId: projectB.id })
        assert.ok(a.system.includes('LC-SCOPED-SKILL'), 'the project plugin loads in its project')
        assert.ok(a.system.includes('LC-USER-SKILL'))
        assert.ok(!b.system.includes('LC-SCOPED-SKILL'), 'a project plugin stays in its project')
        assert.ok(b.system.includes('LC-USER-SKILL'), 'a user plugin loads in every project')

        // "If you name a plugin that isn't installed in the current project … `Plugin "<plugin>" is not installed in this project`".
        assert.match(await say('/plugin remove lc-scoped'), /is not installed/)
        assert.equal(await inA.say('/plugin remove lc-scoped'), 'Removed `lc-scoped`.')
        assert.ok(!existsSync(path.join(dirA, '.localix', 'plugins', 'lc-scoped')))
      }).finally(() => cleanup(rt, { plugins: ['lc-scoped'], projectId: projectA.id }))
    },
  },
  {
    name: 'cc-lifecycle: /plugin list prints a marketplace-installed plugin with its version, scope and status',
    known: 'The line names status and scope but no version: "- enabled `mk-listed` _(global)_".',
    async run(rt) {
      await withMarket(rt, 'lc-listed', { 'mk-listed': {} }, async ({ say }) => {
        await say('/plugin install mk-listed@lc-listed')
        // "`/plugin list` | Prints your marketplace-installed plugins inline, with version, scope,
        // and status".
        const line = (await say('/plugin list')).split('\n').find((l) => l.includes('mk-listed'))
        assert.ok(line, 'the plugin is listed')
        assert.match(line, /enabled/)
        assert.match(line, /1\.0\.0/)
      })
    },
  },
  {
    name: 'cc-lifecycle: removing a plugin Claude Code installed turns it off, keeps its files and names claude plugin uninstall',
    async run(rt) {
      const claude = path.join(rt.root, 'home', '.claude')
      const cache = path.join(claude, 'plugins', 'cache', 'ccmkt')
      const dir = path.join(cache, 'cc-owned', '1.0.0')
      const records = path.join(claude, 'plugins', 'installed_plugins.json')
      const settingsFile = path.join(claude, 'settings.json')
      // Claude Code's files belong to the whole run: put back what was there before.
      const saved = [records, settingsFile].map((file) => [
        file,
        existsSync(file) ? readFileSync(file) : null,
      ])
      writeTree(dir, { '.claude-plugin/plugin.json': manifest('cc-owned') })
      const install = { scope: 'user', installPath: dir, version: '1.0.0' }
      writeTree(claude, {
        'plugins/installed_plugins.json': JSON.stringify({
          version: 2,
          plugins: { 'cc-owned@ccmkt': [install] },
        }),
        'settings.json': JSON.stringify({ enabledPlugins: { 'cc-owned@ccmkt': true } }),
      })
      const { say } = await chat(rt)
      try {
        await say('/plugin reload')
        assert.match(await say('/plugin details cc-owned'), /Imported from Claude Code/)
        // Claude Code's own command removes it: "claude plugin uninstall <plugin> [options]".
        // Localix leaves Claude Code's install alone and turns it off here (its own behaviour).
        assert.match(
          await say('/plugin remove cc-owned'),
          /`claude plugin uninstall cc-owned@ccmkt`/,
        )
        assert.ok(existsSync(path.join(dir, '.claude-plugin', 'plugin.json')), 'its files stay')
        assert.match(await say('/plugin details cc-owned'), /\*\*Enabled:\*\* no/)
      } finally {
        for (const [file, bytes] of saved)
          if (bytes) writeFileSync(file, bytes)
          else rmSync(file, { force: true })
        rmSync(cache, { recursive: true, force: true })
        await say('/plugin reload')
        // The install is gone now; this drops the "disabled" state Localix kept for it.
        await cleanup(rt, { plugins: ['cc-owned'] })
      }
    },
  },
  {
    name: 'cc-lifecycle: a hosted marketplace.json lists its plugins, and an archive entry on a plain-http loopback host is refused',
    async run(rt) {
      const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(request) {
          if (new URL(request.url).pathname !== '/marketplace.json')
            return new Response('no', { status: 404 })
          const source = { source: 'archive', url: `http://127.0.0.1:${server.port}/zipped.zip` }
          const plugins = [{ name: 'zipped', description: 'Zipped', source }]
          return Response.json({ name: 'lc-hosted', owner: { name: 'E2E' }, plugins })
        },
      })
      const { say } = await chat(rt)
      try {
        // "Any other `http://` or `https://` URL … | `url` | Fetches the URL as a `marketplace.json`".
        const url = `http://127.0.0.1:${server.port}/marketplace.json`
        assert.match(
          await say(`/plugin marketplace add ${url}`),
          /^Added marketplace `lc-hosted` \(1 plugins\)/,
        )
        assert.match(await say('/plugin marketplace list lc-hosted'), /- `zipped` — Zipped/)
        // archive source: "`url` must use `https://` and can't point at a loopback … host".
        assert.match(await say('/plugin install zipped@lc-hosted'), /^Install failed: .*https:\/\//)
        assert.doesNotMatch(await say('/plugin list'), /`zipped`/)
      } finally {
        server.stop(true)
        await cleanup(rt, { markets: ['lc-hosted'], plugins: ['zipped'] })
      }
    },
  },
]
