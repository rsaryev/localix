import { GIT_READONLY } from './bash-readonly-heads'

/**
 * WHICH `git` CALLS ONLY READ.
 *
 * The read subcommands are allowlisted, but several of them also write: `git diff/log/show
 * --output=FILE` writes the patch to a file, `git branch NAME` and `git tag NAME` create refs
 * even when a display flag like `-v` or `--sort=…` is present (measured on git 2.50: only the
 * flags that switch to LIST mode stop the create), `git branch --set-upstream-to=X` rewrites
 * config, `git remote -v add …` adds a remote, and `git config edit` opens the config for
 * writing. A deny-list of exact flag spellings missed each of these.
 *
 * So ref listings are judged positively — every flag must be a known listing/display flag, and
 * a name operand is allowed only next to a flag that forces list mode — and everything not
 * understood is a write. git also accepts unambiguous ABBREVIATIONS of long options, which is
 * why the write-flag checks below match a prefix, not a spelling.
 */

/** `--outp=x` is `--output=x` to git: a long flag matches every option it abbreviates. */
function abbreviates(arg: string, longs: readonly string[]): boolean {
  if (!arg.startsWith('--')) return false
  const name = arg.slice(2).split('=')[0]!
  return name.length > 0 && longs.some((long) => long.startsWith(name))
}

interface RefListSpec {
  /** Flags that put the command in LIST mode, so a name operand is a pattern, not a create. */
  listShorts: string
  listLongs: readonly string[]
  /** Display-only flags: harmless, but they leave the command in CREATE mode. */
  readShorts: string
  readLongs: readonly string[]
  /** Long flags whose value may be the next word (`--sort -committerdate`). */
  valuedLongs: readonly string[]
  /** A short flag that takes an attached count (`git tag -n3`). */
  countShort?: string
}

const LIST_FILTERS = ['list', 'contains', 'no-contains', 'merged', 'no-merged', 'points-at']
const DISPLAY = [
  'color',
  'no-color',
  'sort',
  'format',
  'column',
  'no-column',
  'ignore-case',
  'omit-empty',
]

const BRANCH: RefListSpec = {
  listShorts: 'lar',
  listLongs: [...LIST_FILTERS, 'all', 'remotes', 'show-current'],
  readShorts: 'vi',
  readLongs: [...DISPLAY, 'verbose', 'abbrev', 'no-abbrev'],
  valuedLongs: ['sort', 'format'],
}
const TAG: RefListSpec = {
  listShorts: 'ln',
  listLongs: LIST_FILTERS,
  readShorts: 'i',
  readLongs: DISPLAY,
  valuedLongs: ['sort', 'format'],
  countShort: 'n',
}

function isRefListing(args: readonly string[], spec: RefListSpec): boolean {
  let listing = false
  let named = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      named ||= i + 1 < args.length
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
      if (spec.listLongs.includes(name)) listing = true
      else if (!spec.readLongs.includes(name)) return false
      if (eq < 0 && spec.valuedLongs.includes(name)) i++
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      let cluster = arg.slice(1)
      if (spec.countShort && cluster.startsWith(spec.countShort))
        cluster = cluster.replace(/^(.)\d+$/, '$1')
      for (const c of cluster) {
        if (spec.listShorts.includes(c)) listing = true
        else if (!spec.readShorts.includes(c)) return false
      }
      continue
    }
    named = true
  }
  return !named || listing
}

const CONFIG_WRITE_LONGS = [
  'unset',
  'unset-all',
  'add',
  'replace-all',
  'remove-section',
  'rename-section',
  'edit',
]
const CONFIG_READ_LONGS = ['get', 'get-all', 'get-regexp', 'get-urlmatch', 'list']
/** git >= 2.46 subcommand form of `git config`. */
const CONFIG_WRITE_SUBS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])

function isConfigRead(args: readonly string[]): boolean {
  if (args.some((w) => w === '-e' || abbreviates(w, CONFIG_WRITE_LONGS))) return false
  const positionals = args.filter((w) => !w.startsWith('-'))
  if (positionals[0] && CONFIG_WRITE_SUBS.has(positionals[0])) return false
  if (positionals[0] === 'get' || positionals[0] === 'list') return true
  const readFlag = (w: string) =>
    w === '-l' || (w.startsWith('--') && CONFIG_READ_LONGS.includes(w.slice(2).split('=')[0]!))
  if (args.some(readFlag)) return true
  // Positional form: `git config key` reads a value; `git config key value` writes.
  return positionals.length === 1
}

/** `args` are the words after `git`. */
export function isReadOnlyGit(args: readonly string[]): boolean {
  const [sub, ...rest] = args
  if (!sub || !GIT_READONLY.has(sub)) return false
  // The diff family writes its output to a file with `--output`; no read needs it.
  if (rest.some((w) => abbreviates(w, ['output']))) return false
  switch (sub) {
    case 'stash':
      // Bare `git stash` is `push`; only the listing forms read.
      return rest[0] === 'list' || rest[0] === 'show'
    case 'config':
      return isConfigRead(rest)
    case 'branch':
      return isRefListing(rest, BRANCH)
    case 'tag':
      return isRefListing(rest, TAG)
    case 'remote': {
      // `-v` is a global flag of `git remote`, so `git remote -v add x url` still adds.
      let k = 0
      while (rest[k] === '-v' || rest[k] === '--verbose') k++
      const op = rest[k]
      return op === undefined || op === 'show' || op === 'get-url'
    }
    default:
      return true
  }
}
