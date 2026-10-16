import { describe, expect, test } from 'bun:test'
import { isReadOnlyCommand } from './bash-readonly-classify'
import { isReadOnlySedScript } from './bash-readonly-sed'

/**
 * Every command here was answered READ by the head-only classifier while it writes a file,
 * sets system state or runs a program. The classifier decides what a read-only session runs
 * without asking, so each row is a would-be silent write in that mode.
 */
const WRITES_OR_EXECUTES: ReadonlyArray<readonly [string, string]> = [
  // command / process substitution hidden inside a word
  ['backtick', 'echo `touch x`'],
  ['backtick in double quotes', 'echo "`touch x`"'],
  ['$() in double quotes', 'echo "$(touch x)"'],
  ['unquoted $()', 'echo $(touch x)'],
  ['$() inside a word', 'cat a"$(touch x)"b'],
  ['process substitution <()', 'cat <(touch x)'],
  ['process substitution >()', 'echo hi >(touch x)'],
  ['<() in double quotes', 'echo "<(touch x)"'],
  ['arithmetic $(())', 'echo $((1+2))'],
  ['ANSI-C quote desync', "echo $'\\'' $(touch x) ''"],
  ['prompt transform', 'echo ${X@P}'],
  ['printf -v subscript', "printf -v 'a[$(touch x)]' y"],
  ['test -v subscript', "test -v 'a[$(touch x)]'"],
  // sed: in-place spellings, script writes, script executes
  ['sed -i.bak', 'sed -i.bak s/a/b/ f'],
  ['sed -ni', "sed -ni 's/a/b/p' f"],
  ['sed -Ei', "sed -Ei 's/a/b/' f"],
  ['sed --in-place', "sed --in-place 's/a/b/' f"],
  ['sed --in-place=.bak', "sed --in-place=.bak 's/a/b/' f"],
  ['sed BSD -I', "sed -I '' 's/a/b/' f"],
  ['sed -i after operands', "sed 's/a/b/' f -i"],
  ['sed w command', "sed -n '1w out.txt' f"],
  ['sed W command', "sed -n 'W out.txt' f"],
  ['sed w after a label', "sed ':a;w out' f"],
  ['sed s///w flag', "sed 's/a/b/w out.txt' f"],
  ['sed s///gw flag', "sed 's/a/b/gw out.txt' f"],
  ['sed s///e flag', "sed 's/a/b/e' f"],
  ['sed e command', "sed '1e touch x' f"],
  ['sed w in a block', "sed -n -e '/x/{p;w out' -e '}' f"],
  ['sed w in a second -e', "sed -e p -e 'w out' f"],
  ['sed --expression w', "sed --expression='w out' f"],
  ['sed script file', 'sed -f script.sed f'],
  ['sed bracket hides the delimiter', "sed 's/[/]/x/w out' f"],
  ['sed opaque flag', 'sed $FLAGS s/a/b/ f'],
  ['sed glob may expand to -i', 'sed -n 1p *'],
  // sort / uniq / xxd / tree / yq
  ['sort -o', 'sort -o out.txt in.txt'],
  ['sort -no clustered', 'sort -no out.txt in.txt'],
  ['sort --output=', 'sort --output=out.txt in.txt'],
  ['sort --output FILE', 'sort --output out.txt in.txt'],
  ['sort --out abbreviation', 'sort --out=out.txt in.txt'],
  ['sort --compress-program', 'sort --compress-program=sh in.txt'],
  ['uniq IN OUT', 'uniq in.txt out.txt'],
  ['uniq -c IN OUT', 'uniq -c -f 1 in.txt out.txt'],
  ['xxd -r IN OUT', 'xxd -r in.hex out.bin'],
  ['xxd IN OUT', 'xxd in.bin out.hex'],
  ['tree -o', 'tree -o out.txt'],
  ['tree -R', 'tree -R -H . '],
  ['yq -i', "yq -i '.a = 1' f.yaml"],
  ['yq --inplace', "yq --inplace '.a = 1' f.yaml"],
  ['yq split-exp', "yq -s '.name' f.yaml"],
  // find
  ['find -fprint0', 'find . -fprint0 out'],
  ['find -fprintf', 'find . -fprintf out %p'],
  ['find -fls', 'find . -fls out'],
  ['find -ok', 'find . -ok rm {} ;'],
  ['find -okdir', 'find . -okdir rm {} ;'],
  ['find -execdir', 'find . -execdir rm {} ;'],
  // git
  ['git diff --output=', 'git diff --output=patch.diff'],
  ['git diff --output FILE', 'git diff --output patch.diff'],
  ['git log --output', 'git log -p --output=x'],
  ['git show --output', 'git show --output=x HEAD'],
  ['git stash show --output', 'git stash show -p --output=x'],
  ['git branch -v NAME creates', 'git branch -v newbranch'],
  ['git branch --sort= NAME creates', 'git branch --sort=refname newbranch'],
  ['git branch --format NAME creates', 'git branch --format %(refname) newbranch'],
  ['git branch --set-upstream-to=', 'git branch --set-upstream-to=origin/main'],
  ['git branch -dNAME', 'git branch -dold'],
  ['git branch -q NAME', 'git branch -q newbranch'],
  ['git tag --sort= NAME creates', 'git tag --sort=refname v9'],
  ['git remote -v add', 'git remote -v add up https://x'],
  ['git config edit', 'git config edit'],
  ['git config set', 'git config set user.name Bob'],
  ['git config --unset-al abbreviation', 'git config --unset-al user.name'],
  // system state and program runners
  ['date -s', "date -s '2020-01-01'"],
  ['date --set', "date --set='2020-01-01'"],
  ['date operand', 'date 0101000020'],
  ['hostname NAME', 'hostname newname'],
  ['hostname -F', 'hostname -F /etc/hostname'],
  ['file -C', 'file -C -m magic'],
  ['fd -x', 'fd -e ts -x rm'],
  ['fd --exec', 'fd --exec rm'],
  ['rg --pre', 'rg --pre ./run.sh foo'],
  ['ag --pager', 'ag --pager=sh foo'],
  ['bat --pager', 'bat --pager=sh f'],
  ['bat cache', 'bat cache --clear'],
  // version probe of a path or an expansion
  ['script version probe', './install.sh --version'],
  ['opaque version probe', '$X --version'],
  // `-v` that starts an interpreter reading stdin, and `version` that is a real subcommand
  ['python -v', 'python3 -v'],
  ['sh -v', 'sh -v'],
  ['bash -v', 'bash -v'],
  ['ruby -v', 'ruby -v'],
  ['npm version', 'npm version'],
  ['make version', 'make version'],
]

const READS: readonly string[] = [
  'sed -n 1,10p f',
  "sed -n '/start/,/end/p' f",
  "sed 's/a/b/g' f",
  "sed -E 's/[0-9]+/N/2' f",
  "sed -n '1{p;q}' f",
  "sed -n -e '$p' f",
  "sed 's|/usr|/opt|' f",
  "sed '/x/a appended text' f",
  'sort f',
  'sort -t: -k2 -rn f',
  'uniq f',
  'uniq -c f',
  'xxd f',
  'xxd -l 64 f',
  'xxd -r f',
  'tree -L 2',
  "yq '.a' f.yaml",
  "yq -o json '.a' f.yaml",
  'find . -name x -print',
  'find . -name "*.ts" -type f',
  'git diff',
  'git diff --stat HEAD~1',
  'git log --oneline -n 5',
  'git branch',
  'git branch -a',
  'git branch -vv',
  'git branch --show-current',
  'git branch --list "feat/*" -v',
  'git branch --merged main',
  'git branch --sort=-committerdate',
  'git branch --sort -committerdate',
  'git tag',
  'git tag -n3',
  'git tag -l "v*"',
  'git remote -v',
  'git remote get-url origin',
  'git config get user.name',
  'date',
  'date +%Y-%m-%d',
  "date -d '1 day ago' +%F",
  'date -u',
  'hostname',
  'hostname -s',
  "echo '$(x)'",
  "echo '`x`'",
  'echo "a\\$(x)"',
  'echo $HOME',
  'ls $HOME',
  'grep -r foo .',
  'rg --type ts foo',
  'fd -e ts',
  'file f',
  'printf "%s\\n" a',
  'ls # a comment',
  'ls && which bun && bun --version 2>/dev/null',
  'node -v',
  'python3 -V',
  'python3 --version',
  'go version',
  'docker version',
  'ls -la && echo "---bun---" && which bun && bun --version 2>/dev/null || echo "bun not found"',
]

describe('isReadOnlyCommand: arguments and substitutions that write', () => {
  test.each(WRITES_OR_EXECUTES)('%s: %s is not read-only', (_label, command) => {
    expect(isReadOnlyCommand(command)).toBe(false)
  })

  test.each(READS.map((c) => [c]))('%s stays read-only', (command) => {
    expect(isReadOnlyCommand(command)).toBe(true)
  })
})

describe('isReadOnlySedScript', () => {
  test('a command the parser does not know is refused, not skipped', () => {
    expect(isReadOnlySedScript('v')).toBe(false)
    expect(isReadOnlySedScript('1k')).toBe(false)
    expect(isReadOnlySedScript('s/a/b/x')).toBe(false)
  })

  test('a label stops at the earliest point any sed would, so a following w is still seen', () => {
    expect(isReadOnlySedScript(':a;N;ba')).toBe(true)
    expect(isReadOnlySedScript('ba;w out')).toBe(false)
  })
})
