// The preload every workspace's bunfig.toml lists. A test sees a machine with nothing of the
// developer's on it, as git's own t/test-lib.sh arranges: no git repository variables, no network,
// and a HOME of its own, so a spawned shell, git or tool never reads the developer's dotfiles
// (~/.bashrc, ~/.gitconfig, ~/.npmrc …). Bun reads bunfig.toml only from the directory a run starts
// in, so each workspace that has tests lists this file; scripts/test-tiers.test.ts checks it.
import { mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scrubGitEnv } from '../git-env'
import './network-guard'

scrubGitEnv(process.env)
const testHome = mkdtempSync(join(tmpdir(), 'localix-test-home-'))
process.env.HOME = testHome
// Bun reads the home once, when the process starts, so `os.homedir()` would go on answering the
// developer's home and a test would read their ~/.claude. It stays fixed for the process, as the
// OS account's home is — a test that unsets or spoofs HOME moves nothing — but it is this one.
// Modules imported from here on get it through the mock; `require('node:os')` callers through
// the patched object.
const homedir = () => testHome
os.homedir = homedir
void mock.module('node:os', () => ({ ...os, homedir, default: os }))
for (const key of ['BASH_ENV', 'ENV', 'ZDOTDIR', 'XDG_CONFIG_HOME']) delete process.env[key]
