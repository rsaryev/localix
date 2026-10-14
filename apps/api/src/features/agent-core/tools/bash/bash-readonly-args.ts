import { isReadOnlyGit } from './bash-readonly-git'
import { PKG_READONLY } from './bash-readonly-heads'
import { isReadOnlySed } from './bash-readonly-sed'

/**
 * WHICH ARGUMENTS TURN AN ALLOWLISTED READ INTO A WRITE.
 *
 * A head on the read-only list is a read only in its usual shape: `sort -o FILE` writes FILE,
 * `uniq IN OUT` writes OUT, `xxd IN OUT` writes OUT, `tree -o FILE`, `yq -i`, `date -s …`,
 * `hostname NAME`, `file -C`, `find … -fprint0 F` / `-ok cmd` write or execute, and `fd -x`,
 * `rg --pre CMD`, `ag --pager CMD`, `bat --pager CMD` run a program. Each was answered READ
 * because only the head was judged. This table is the one place a head says which of its
 * arguments write; a head absent from it has no argument that can (`cat`, `ls`, `grep`, …).
 *
 * Arguments are matched as getopt sees them: short flags may be clustered (`-no` is `-n -o`),
 * a value-taking short swallows the rest of its cluster or the next word, and long options
 * may be abbreviated (`--out=F` is `--output=F`), so a long flag matches every option it
 * could abbreviate. GNU tools also accept options AFTER operands, so every word is scanned.
 */

/** A rule answers true when the call, judged by its arguments, can only read. */
export type ArgRule = (args: readonly string[]) => boolean

interface ScannedArgs {
  shorts: Set<string>
  longs: string[]
  positionals: string[]
}

interface ArgPolicy {
  /** Short options that consume a value (attached or the next word). */
  valuedShorts?: string
  /** Long options whose value may be the next word. */
  valuedLongs?: readonly string[]
  writeShorts?: string
  writeLongs?: readonly string[]
  /** More operands than this name an output file (`uniq IN OUT`). */
  maxOperands?: number
  /** A head-specific write shape the flags above cannot express. */
  writes?: (scanned: ScannedArgs) => boolean
}

function scan(args: readonly string[], policy: ArgPolicy): ScannedArgs {
  const out: ScannedArgs = { shorts: new Set(), longs: [], positionals: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      out.positionals.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
      out.longs.push(name)
      if (eq < 0 && policy.valuedLongs?.includes(name)) i++
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j]!
        out.shorts.add(c)
        if (policy.valuedShorts?.includes(c)) {
          if (j === arg.length - 1) i++
          break
        }
      }
      continue
    }
    out.positionals.push(arg)
  }
  return out
}

function byPolicy(policy: ArgPolicy): ArgRule {
  return (args) => {
    const scanned = scan(args, policy)
    // Short flags are single ASCII letters, so splitting by UTF-16 unit is exact here.
    if ((policy.writeShorts ?? '').split('').some((c) => scanned.shorts.has(c))) return false
    const longs = policy.writeLongs ?? []
    if (scanned.longs.some((name) => name.length > 0 && longs.some((l) => l.startsWith(name))))
      return false
    if (policy.maxOperands !== undefined && scanned.positionals.length > policy.maxOperands)
      return false
    return !policy.writes?.(scanned)
  }
}

/** `find` primaries are whole words, not getopt clusters. */
const FIND_WRITE_PRIMARIES = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
])

/** npm/yarn/pnpm/bun read only through their listing subcommands. */
const pkgRead: ArgRule = (args) => args[0] !== undefined && PKG_READONLY.has(args[0])

export const HEAD_ARG_RULES: Readonly<Record<string, ArgRule>> = {
  git: isReadOnlyGit,
  npm: pkgRead,
  yarn: pkgRead,
  pnpm: pkgRead,
  bun: pkgRead,
  sed: isReadOnlySed,
  find: (args) => !args.some((w) => FIND_WRITE_PRIMARIES.has(w)),
  sort: byPolicy({
    valuedShorts: 'kotST',
    writeShorts: 'o',
    writeLongs: ['output', 'compress-program'],
  }),
  uniq: byPolicy({
    valuedShorts: 'fsw',
    valuedLongs: ['skip-fields', 'skip-chars', 'check-chars'],
    maxOperands: 1,
  }),
  xxd: byPolicy({ valuedShorts: 'cglosn', maxOperands: 1 }),
  // `-R` reruns `-H` output into a `00Tree.html` in every directory.
  tree: byPolicy({ valuedShorts: 'LPIoHT', writeShorts: 'oR' }),
  yq: byPolicy({ valuedShorts: 'oIps', writeShorts: 'is', writeLongs: ['inplace', 'split-exp'] }),
  // An operand that is not a `+FORMAT` sets the clock (GNU and BSD), unless BSD `-j`.
  date: byPolicy({
    valuedShorts: 'dfrsvz',
    valuedLongs: ['date', 'file', 'reference', 'set'],
    writeShorts: 's',
    writeLongs: ['set'],
    writes: ({ shorts, positionals }) =>
      !shorts.has('j') && positionals.some((p) => !p.startsWith('+')),
  }),
  hostname: byPolicy({
    valuedShorts: 'F',
    writeShorts: 'Fb',
    writeLongs: ['file', 'boot'],
    maxOperands: 0,
  }),
  file: byPolicy({ valuedShorts: 'mfFeP', writeShorts: 'C', writeLongs: ['compile'] }),
  fd: byPolicy({
    valuedShorts: 'dEetcjSoxX',
    writeShorts: 'xX',
    writeLongs: ['exec', 'exec-batch'],
  }),
  rg: byPolicy({ writeLongs: ['pre', 'hostname-bin'] }),
  ag: byPolicy({ writeLongs: ['pager'] }),
  bat: byPolicy({
    valuedShorts: 'lHrm',
    writeLongs: ['pager'],
    writes: ({ positionals }) => positionals[0] === 'cache',
  }),
  // `printf -v 'a[$(cmd)]'` and `test -v 'a[$(cmd)]'` evaluate an array subscript, which
  // runs a command substitution the quoting hid from the substitution scan.
  printf: byPolicy({ writeShorts: 'v' }),
  test: byPolicy({ writeShorts: 'v' }),
}
