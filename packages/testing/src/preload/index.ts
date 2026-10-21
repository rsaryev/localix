// The preload every workspace's bunfig.toml lists: tests start without git's repository variables
// and without network access. Bun reads bunfig.toml only from the directory a run starts in, so
// each workspace that has tests lists this file; scripts/test-tiers.test.ts checks that they do.
import { scrubGitEnv } from '../git-env'
import './network-guard'

scrubGitEnv(process.env)
