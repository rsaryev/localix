import { isAbsolute, join, resolve } from 'node:path'

import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import { bashRuleSubject } from './settings-bash-match'

/**
 * The files a shell line names, as Claude Code's `Read` and `Edit` rules see them (permissions.md,
 * "Read and Edit": the rules "apply … to file commands Claude Code recognizes in Bash, such as
 * `cat`, `head`, `tail`, `sed`, and `tee`, and to the targets of Bash redirections such as
 * `> file` and `< file`"). A command that opens files without naming them is not covered, as in
 * Claude Code; this is a lexical reading of the line, not a sandbox.
 */

/** Commands whose operands are files they read. */
const READERS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'bat',
  'nl',
  'wc',
  'sort',
  'uniq',
  'diff',
  'cmp',
  'xxd',
  'od',
  'hexdump',
  'strings',
  'file',
  'stat',
  'md5sum',
  'shasum',
  'sha256sum',
  'base64',
  'source',
  '.',
  'jq',
  'yq',
  'awk',
  'cut',
  'tr',
  'column',
  'grep',
  'rg',
  'egrep',
  'fgrep',
])
/** Commands whose operands are files they write. */
const WRITERS = new Set(['tee', 'touch', 'rm', 'truncate', 'chmod', 'chown', 'mkdir', 'rmdir'])
/** The last operand is written, the others read. */
const COPIERS = new Set(['cp', 'mv', 'install', 'ln', 'rsync'])
/** The first operand is a pattern or a program, not a file. */
const PATTERN_FIRST = new Set([
  'grep',
  'rg',
  'egrep',
  'fgrep',
  'jq',
  'yq',
  'awk',
  'sed',
  'tr',
  'cut',
])

const unquote = (word: string) => word.replace(/^(['"])(.*)\1$/, '$2')

function tokens(command: string): string[] {
  return (command.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? []).map(unquote)
}

export interface BashFiles {
  reads: string[]
  writes: string[]
}

export function bashFiles(commandLine: string, cwd: string, homeDir: string): BashFiles {
  const out: BashFiles = { reads: [], writes: [] }
  const abs = (path: string) =>
    path === '~' || path.startsWith('~/')
      ? join(homeDir, path.slice(1))
      : isAbsolute(path)
        ? path
        : resolve(cwd, path)
  const subcommands = splitCompoundCommand(commandLine) ?? commandLine.split(/&&|\|\||[;|&\n]/)
  for (const sub of subcommands) {
    const words = tokens(bashRuleSubject(sub, false) ?? sub)
    const operands: string[] = []
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!
      // Redirections: `> f`, `>> f`, `2> f`, `< f`, and their glued forms.
      const redirect = /^(\d*)(>>?|<)(.*)$/.exec(word)
      if (redirect) {
        const target = redirect[3] || words[++i]
        if (target && !target.startsWith('&') && target !== '/dev/null')
          (redirect[2] === '<' ? out.reads : out.writes).push(abs(target))
        continue
      }
      if (i > 0 && !word.startsWith('-')) operands.push(word)
    }
    const head = words[0]
    if (!head) continue
    const inPlace = head === 'sed' && words.some((w) => w.startsWith('-i') || w === '--in-place')
    const files = PATTERN_FIRST.has(head) ? operands.slice(1) : operands
    if (READERS.has(head)) out.reads.push(...files.map(abs))
    else if (head === 'sed') (inPlace ? out.writes : out.reads).push(...files.map(abs))
    else if (WRITERS.has(head)) out.writes.push(...files.map(abs))
    else if (COPIERS.has(head) && files.length >= 2) {
      out.reads.push(...files.slice(0, -1).map(abs))
      out.writes.push(abs(files.at(-1)!))
    }
  }
  return out
}
