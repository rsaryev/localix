// The preload every workspace's bunfig.toml lists. A test sees a machine with nothing of the
// developer's on it, as git's own t/test-lib.sh arranges: no git repository variables, no network,
// and a HOME of its own, so a spawned shell, git or tool never reads the developer's dotfiles
// (~/.bashrc, ~/.gitconfig, ~/.npmrc …). Bun reads bunfig.toml only from the directory a run starts
// in, so each workspace that has tests lists this file; scripts/test-tiers.test.ts checks it.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scrubGitEnv } from '../git-env'
import './network-guard'

scrubGitEnv(process.env)
process.env.HOME = mkdtempSync(join(tmpdir(), 'localix-test-home-'))
for (const key of ['BASH_ENV', 'ENV', 'ZDOTDIR', 'XDG_CONFIG_HOME']) delete process.env[key]
