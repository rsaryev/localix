// Tests never act on the developer's repository. A git hook exports GIT_DIR, GIT_INDEX_FILE and
// friends, and git honours them over `cwd`, so any test that spawns git under pre-commit (above
// all from a linked worktree) would configure, commit and tag the real repository. Every test
// process starts without them; scratch repositories still pin their own config through
// `scratchGitEnv`.
import { scrubGitEnv } from './scratch-git-env.mjs'

scrubGitEnv(process.env)
