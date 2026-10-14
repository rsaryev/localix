/**
 * WHICH COMMANDS ONLY LOOK — the data half of the read-only classifier.
 *
 * A list, kept apart from the parser that uses it, because the two are edited by different
 * people for different reasons: adding `rg` to the allowlist is a five-second judgement about
 * one binary, while touching the tokenizer is a change to how every command is judged. Mixing
 * them put a 60-line vocabulary in the middle of the logic that reads it.
 *
 * Fail-closed by construction: a head that is NOT here is treated as mutating, so forgetting
 * to add one costs a confirmation, never a silent write.
 */

export const READONLY_HEADS = new Set([
  'ls',
  'cat',
  'bat',
  'head',
  'tail',
  'wc',
  'pwd',
  'echo',
  'printf',
  'which',
  'type',
  'grep',
  'rg',
  'ag',
  'find',
  'fd',
  'tree',
  'stat',
  'file',
  'du',
  'df',
  'env',
  'printenv',
  'date',
  'whoami',
  'hostname',
  'uname',
  'id',
  'realpath',
  'readlink',
  'dirname',
  'basename',
  'sort',
  'uniq',
  'cut',
  'tr',
  'sed',
  'jq',
  'yq',
  'column',
  'diff',
  'cmp',
  'nl',
  'tac',
  'xxd',
  'od',
  'ps',
  'uptime',
  'git',
  'npm',
  'yarn',
  'pnpm',
  'bun',
  'cd',
  'true',
  'test',
])
/** Read-only subcommands for tools that both read and write. */
export const GIT_READONLY = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'blame',
  'remote',
  'rev-parse',
  'describe',
  'ls-files',
  'config',
  'tag',
  'stash',
])
export const PKG_READONLY = new Set(['list', 'ls', 'view', 'info', 'outdated', 'why'])
