/** Session E2E: plugin lifecycle — marketplaces, updates, dependencies and defaultEnabled. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { writeTree } from './scenarios-cc-helpers.mjs'
import {
  bump,
  manifest,
  pluginsDir,
  probe,
  skill,
  withMarket,
  withPlugin,
} from './scenarios-cc-lifecycle-helpers.mjs'

export const CC_LIFECYCLE_MARKETPLACE_SCENARIOS = [
  {
    name: 'cc-lifecycle: a local marketplace lists and installs name@marketplace, refuses a same-name marketplace from another source, updates, and removing it uninstalls its plugins',
    async run(rt) {
      const impostor = path.join(rt.root, 'market-impostor')
      const catalog = { name: 'lc-market', owner: { name: 'Other' }, plugins: [] }
      writeTree(impostor, { '.claude-plugin/marketplace.json': JSON.stringify(catalog) })
      const plugins = { 'mk-solo': { 'skills/solo/SKILL.md': skill('solo', 'MK-SOLO-SKILL') } }
      await withMarket(rt, 'lc-market', plugins, async ({ say, dir, added }) => {
        // "Add a marketplace from … a local path"; "using the `name` from the marketplace's own manifest".
        assert.equal(
          added,
          'Added marketplace `lc-market` (1 plugins). Install one with `/plugin install <name>@lc-market`.',
        )
        // "`/plugin marketplace list` | Prints your marketplace names inline".
        assert.match(await say('/plugin marketplace list'), /- `lc-market` — 1 plugins/)
        assert.match(await say('/plugin marketplace list lc-market'), /- `mk-solo` — mk-solo entry/)
        const install = await say('/plugin install mk-solo@lc-market')
        assert.match(install, /^Installed `mk-solo` v1\.0\.0 for all chats/)
        assert.ok((await probe(rt)).system.includes('MK-SOLO-SKILL'))

        // "Each user registers one marketplace per `name`, so a user can't have two marketplaces with the same name".
        assert.match(
          await say(`/plugin marketplace add ${impostor}`),
          /^Marketplace add failed: .*already added from a different source/,
        )
        assert.match(await say('/plugin marketplace list lc-market'), /`mk-solo`/, 'first one kept')

        // "Update marketplace … refreshes the marketplace's listing, updates the plugins you
        // installed from it, and reports any plugin it left for you to update yourself" (install.md).
        const solo = path.join(dir, 'plugins/mk-solo')
        bump(solo, 'mk-solo', '1.1.0')
        writeTree(solo, { 'skills/solo/SKILL.md': skill('solo', 'MK-SOLO-SKILL-V2') })
        assert.doesNotMatch(await say('/plugin marketplace update lc-market'), /fail|not updated/i)
        // `claude plugin details` "prints the plugin's name, version, description, and source".
        assert.match(await say('/plugin details mk-solo'), /\*\*mk-solo\*\* v1\.1\.0/)
        assert.ok((await probe(rt)).system.includes('MK-SOLO-SKILL-V2'), 'the update loads')

        // "When you remove a marketplace from the last scope that declares it, Claude Code also …
        // uninstalls every plugin you installed from it"; "the output lists them".
        assert.match(
          await say('/plugin marketplace remove lc-market'),
          /^Removed marketplace `lc-market`.*`mk-solo`/,
        )
        assert.ok(!existsSync(path.join(pluginsDir(rt), 'mk-solo')))
        // The marketplace was read in place from the person's folder; removing it leaves the folder.
        assert.ok(existsSync(path.join(dir, '.claude-plugin/marketplace.json')), 'source kept')
        assert.ok(existsSync(path.join(solo, 'skills/solo/SKILL.md')), 'plugin source kept')
        assert.doesNotMatch(await say('/plugin list'), /mk-solo/)
        assert.ok(!(await probe(rt)).system.includes('MK-SOLO-SKILL'))
        assert.match(
          await say('/plugin marketplace remove lc-market'),
          /^Marketplace remove failed: .*Unknown marketplace "lc-market"/,
        )
      })
    },
  },
  {
    name: 'cc-lifecycle: /plugin update in an ordinary chat re-installs a user-scope plugin at its new version',
    async run(rt) {
      const files = { 'skills/upd/SKILL.md': skill('upd', 'LC-UPD-V1') }
      await withPlugin(rt, 'lc-upd', files, async ({ say, src }) => {
        bump(src, 'lc-upd', '1.1.0')
        writeTree(src, { 'skills/upd/SKILL.md': skill('upd', 'LC-UPD-V2') })
        // `claude plugin update`: "If you omit `--scope`, the command updates the plugin at the most
        // specific scope it's installed at for your current project, checking local, project,
        // user, then managed" — here the user scope. "The new version loads … after you run
        // `/reload-plugins`".
        assert.match(await say('/plugin update lc-upd'), /v1\.1\.0/)
        await say('/plugin reload')
        assert.ok((await probe(rt)).system.includes('LC-UPD-V2'), 'the new version loads')
      })
    },
  },
  {
    name: 'cc-lifecycle: an edit to a plugin in a local-folder marketplace loads at /plugin reload, with no update and no version bump',
    async run(rt) {
      const plugins = { 'mk-inplace': { 'skills/inplace/SKILL.md': skill('inplace', 'MK-IP-V1') } }
      await withMarket(rt, 'lc-inplace', plugins, async ({ say, dir }) => {
        await say('/plugin install mk-inplace@lc-inplace')
        assert.ok((await probe(rt)).system.includes('MK-IP-V1'), 'the plugin loads')
        const edited = { 'skills/inplace/SKILL.md': skill('inplace', 'MK-IP-V2') }
        writeTree(path.join(dir, 'plugins/mk-inplace'), edited)
        // "Relative-path plugins in a marketplace you added from a local path: the plugin loads in
        // place from its path inside the marketplace folder. Your edits to the source directory
        // take effect at the next session start or `/reload-plugins`, and you don't need to
        // increase the version" (loading.md).
        await say('/plugin reload')
        const { system } = await probe(rt)
        assert.ok(system.includes('MK-IP-V2'), 'the edit did not load')
        assert.ok(!system.includes('MK-IP-V1'), 'the stale copy still loads')
      })
    },
  },
  {
    name: 'cc-lifecycle: installing a plugin installs and enables its dependency, and enabling it re-enables a disabled dependency',
    async run(rt) {
      const plugins = {
        'dep-base': { 'skills/base/SKILL.md': skill('base', 'DEP-BASE-SKILL') },
        'dep-top': {
          '.claude-plugin/plugin.json': manifest('dep-top', { dependencies: ['dep-base'] }),
        },
      }
      await withMarket(rt, 'lc-deps', plugins, async ({ say }) => {
        // "Install: Claude Code also installs and enables the plugin's declared dependencies at the same scope."
        assert.match(await say('/plugin install dep-top@lc-deps'), /^Installed `dep-top`/)
        assert.match(await say('/plugin details dep-base'), /\*\*Enabled:\*\* yes/)
        assert.ok((await probe(rt)).system.includes('DEP-BASE-SKILL'), 'the dependency loads')

        await say('/plugin disable dep-top')
        await say('/plugin disable dep-base')
        assert.ok(!(await probe(rt)).system.includes('DEP-BASE-SKILL'))
        // "Enable: Claude Code also enables the plugin's dependencies that are installed but disabled."
        await say('/plugin enable dep-top')
        assert.match(await say('/plugin details dep-base'), /\*\*Enabled:\*\* yes/)
        assert.ok((await probe(rt)).system.includes('DEP-BASE-SKILL'))
      })
    },
  },
  {
    name: 'cc-lifecycle: the install message names the dependencies it installed',
    async run(rt) {
      const plugins = {
        'dep2-base': {},
        'dep2-top': {
          '.claude-plugin/plugin.json': manifest('dep2-top', { dependencies: ['dep2-base'] }),
        },
      }
      await withMarket(rt, 'lc-deps2', plugins, async ({ say }) => {
        // "Install: Claude Code also installs and enables the plugin's declared dependencies … The success message lists them."
        assert.match(await say('/plugin install dep2-top@lc-deps2'), /dep2-base/)
      })
    },
  },
  {
    name: 'cc-lifecycle: disabling a plugin that another enabled plugin depends on is refused',
    async run(rt) {
      const plugins = {
        'dep3-base': {},
        'dep3-top': {
          '.claude-plugin/plugin.json': manifest('dep3-top', { dependencies: ['dep3-base'] }),
        },
      }
      await withMarket(rt, 'lc-deps3', plugins, async ({ say }) => {
        await say('/plugin install dep3-top@lc-deps3')
        // "Disable: when another enabled plugin still needs the one you named, Claude Code refuses".
        assert.doesNotMatch(await say('/plugin disable dep3-base'), /^Disabled/)
        assert.match(await say('/plugin details dep3-base'), /\*\*Enabled:\*\* yes/)
      })
    },
  },
  {
    name: 'cc-lifecycle: a defaultEnabled false plugin installs turned off until the person enables it',
    async run(rt) {
      const plugins = {
        'mk-off': {
          '.claude-plugin/plugin.json': manifest('mk-off', { defaultEnabled: false }),
          'skills/off/SKILL.md': skill('off', 'MK-OFF-SKILL'),
        },
      }
      await withMarket(rt, 'lc-off', plugins, async ({ say }) => {
        // "Installing a plugin also enables it, unless its manifest or marketplace entry sets
        // `defaultEnabled: false`"; "Such a plugin is installed but stays off until you turn it on".
        assert.doesNotMatch(await say('/plugin install mk-off@lc-off'), /enabled it/)
        assert.match(await say('/plugin details mk-off'), /\*\*Enabled:\*\* no/)
        assert.ok(!(await probe(rt)).system.includes('MK-OFF-SKILL'))
        await say('/plugin enable mk-off')
        assert.ok((await probe(rt)).system.includes('MK-OFF-SKILL'))
      })
    },
  },
]
