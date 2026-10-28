import { describe, it, expect } from 'bun:test'
import {
  parseControlCommand,
  parseSlashInvocation,
  parseSkillCommand,
  applySkillArguments,
  splitCommandArg,
  splitSkillArgs,
} from './slash-commands'
import { SLASH_COMMANDS } from '../slash-catalog'

/**
 * The catalog↔parser coverage the old "keep it in sync" comment only PROMISED. The map is
 * now derived, so this cannot fail by drift — it fails if someone re-hand-rolls the map,
 * which is the point. A `scope: 'server'` command the parser rejects would be offered in
 * every menu and refused by `parseSkillCommand` (its name is reserved). The final
 * unresolved-slash gate now prevents that drift from reaching the model.
 */
describe('catalog ⇄ parser coverage', () => {
  it('every server-scoped catalog command (and each alias) parses', () => {
    const unparsed = SLASH_COMMANDS.flatMap((c) =>
      c.scope === 'server' ? [c.name, ...(c.aliases ?? [])] : [],
    ).filter((word) => parseControlCommand(`/${word}`) === null)
    expect(unparsed).toEqual([])
  })
  it('client-scoped commands are NOT parsed server-side (/fork is intercepted by the composer)', () => {
    const clientCommands = SLASH_COMMANDS.filter((c) => c.scope === 'client')
    // LOAD-BEARING: only two commands are client-scoped. Re-scope or remove them and this loop
    // iterates zero times — the test whose entire purpose is "a client command must never be
    // parsed server-side" would pass while asserting nothing at all.
    expect(clientCommands.length).toBeGreaterThan(0)
    for (const c of clientCommands) {
      expect(parseControlCommand(`/${c.name}`)).toBeNull()
    }
  })
})

describe('splitCommandArg', () => {
  it('strips the command, lowercases the first arg, and keeps the rest verbatim', () => {
    expect(splitCommandArg('/model Sonnet and do X')).toEqual({ value: 'sonnet', rest: 'and do X' })
  })
  it('no argument → undefined value, empty rest', () => {
    expect(splitCommandArg('/usage')).toEqual({ value: undefined, rest: '' })
  })
  it('keeps multiline rest', () => {
    expect(splitCommandArg('/loop 5m line1\nline2')).toEqual({ value: '5m', rest: 'line1\nline2' })
  })
})

describe('splitSkillArgs', () => {
  it('splits on whitespace', () => {
    expect(splitSkillArgs('a b c')).toEqual(['a', 'b', 'c'])
  })
  it('honours double and single quotes as single tokens', () => {
    expect(splitSkillArgs('"hello world" foo')).toEqual(['hello world', 'foo'])
    expect(splitSkillArgs("'single quoted' bar")).toEqual(['single quoted', 'bar'])
  })
  it('empty string → no tokens', () => {
    expect(splitSkillArgs('')).toEqual([])
  })
})

describe('parseControlCommand', () => {
  it('recognizes built-in commands (case-insensitive)', () => {
    expect(parseControlCommand('/help')).toBe('help')
    expect(parseControlCommand('/HELP')).toBe('help')
    expect(parseControlCommand('/usage')).toBe('usage')
    expect(parseControlCommand('/COST')).toBe('usage')
    // `/clear` is a client command (a new chat); it never parses as a server control command.
    expect(parseControlCommand('/clear')).toBeNull()
    // `/compact` is a server command: it asks the runtime for a checkpoint, with no model call.
    expect(parseControlCommand('/compact keep the plan')).toBe('compact')
    expect(parseControlCommand('/model gpt-5')).toBe('model')
    // Valid contributed/synthetic names are not core built-ins.
    expect(parseControlCommand('/sample-command')).toBeNull()
    expect(parseControlCommand('/another-command')).toBeNull()
    expect(parseControlCommand('/memory remember this')).toBe('memory')
    // `/mode` is gone with agent modes; it now falls through as ordinary chat text.
    expect(parseControlCommand('/mode auto')).toBeNull()
    expect(parseControlCommand('/skills')).toBe('skills')
    expect(parseControlCommand('/mcp')).toBe('mcp')
    expect(parseControlCommand('/MCP')).toBe('mcp')
    expect(parseControlCommand('/mcp reconnect github')).toBe('mcp')
    expect(parseControlCommand('/plugin list')).toBe('plugins')
    expect(parseControlCommand('/loop 5m check the deploy')).toBe('loop')
    // `/reasoning` is gone: the level is set in the model picker.
    expect(parseControlCommand('/reasoning high')).toBeNull()
    // `/economy` is gone with the setting; it falls through as ordinary chat text.
    expect(parseControlCommand('/economy on')).toBeNull()
    expect(parseControlCommand('/economy')).toBeNull()
  })

  it('returns null for non-commands', () => {
    expect(parseControlCommand('hello world')).toBeNull()
    expect(parseControlCommand('/unknown')).toBeNull()
  })

  it('/fork is reserved but handled client-side — never a backend control command', () => {
    // `fork` is in BUILTIN_COMMAND_NAMES (a skill can't shadow it) yet must NOT
    // parse as a control command: the composer intercepts `/fork` and calls the
    // forkSession RPC directly. If this ever returns 'fork', a backend handler was
    // wrongly added and /fork would double-dispatch / break.
    expect(parseControlCommand('/fork')).toBeNull()
    expect(parseSkillCommand('/fork')).toBeNull() // reserved → not a skill command either
  })

  it('/yolo is no longer a separate built-in command', () => {
    // /yolo was removed — it must not match as a control command.
    // Users should use /mode yolo instead.
    expect(parseControlCommand('/yolo')).toBeNull()
    expect(parseControlCommand('/yolo do stuff')).toBeNull()
  })
})

describe('parseSlashInvocation', () => {
  it('parses command and namespaced plugin/skill syntax case-insensitively', () => {
    expect(parseSlashInvocation('/Compct Keep This')).toEqual({
      name: 'compct',
      arg: 'Keep This',
    })
    expect(parseSlashInvocation('/git:commit fix')).toEqual({
      name: 'git:commit',
      arg: 'fix',
    })
  })

  it('does not classify absolute/network paths as commands', () => {
    expect(parseSlashInvocation('/tmp/project')).toBeNull()
    expect(parseSlashInvocation('//server/share')).toBeNull()
  })
})

describe('parseSkillCommand', () => {
  it('extracts skill name and argument', () => {
    expect(parseSkillCommand('/deploy')).toEqual({ name: 'deploy', arg: '' })
    expect(parseSkillCommand('/deploy staging now')).toEqual({ name: 'deploy', arg: 'staging now' })
  })

  it('does not shadow built-in commands', () => {
    expect(parseSkillCommand('/usage')).toBeNull()
  })

  it('an unreserved command name is claimable by a plugin or skill', () => {
    expect(parseSkillCommand('/sample-command')).toEqual({ name: 'sample-command', arg: '' })
    expect(parseSkillCommand('/another-command')).toEqual({ name: 'another-command', arg: '' })
  })

  it('ignores plain text and the glued-command regression', () => {
    expect(parseSkillCommand('just a message')).toBeNull()
    // "/commit4010" (no space) parses as its own command name, glued arg and all:
    expect(parseSkillCommand('/commit4010')).toEqual({ name: 'commit4010', arg: '' })
  })

  it('parses colon-namespaced command names (.claude/commands subdirs)', () => {
    // commands/git/commit.md → /git:commit
    expect(parseSkillCommand('/git:commit')).toEqual({ name: 'git:commit', arg: '' })
    expect(parseSkillCommand('/git:commit fix the bug')).toEqual({
      name: 'git:commit',
      arg: 'fix the bug',
    })
    // deeper nesting: commands/a/b/c.md → /a:b:c
    expect(parseSkillCommand('/a:b:c')).toEqual({ name: 'a:b:c', arg: '' })
    // trailing/leading colon is not a valid segment chain
    expect(parseSkillCommand('/git:')).toBeNull()
  })
})

describe('applySkillArguments', () => {
  it('substitutes $ARGUMENTS placeholders', () => {
    expect(applySkillArguments('Deploy to $ARGUMENTS now', 'staging')).toBe('Deploy to staging now')
    expect(applySkillArguments('$ARGUMENTS and $ARGUMENTS', 'x')).toBe('x and x')
  })

  it('appends arguments when no placeholder present', () => {
    expect(applySkillArguments('Do the thing', 'fast')).toBe('Do the thing\n\nARGUMENTS: fast')
    expect(applySkillArguments('Do the thing', '')).toBe('Do the thing')
  })

  it('substitutes $N positional shorthand', () => {
    expect(applySkillArguments('Deploy $0 to $1', 'app staging')).toBe('Deploy app to staging')
  })

  it('substitutes $ARGUMENTS[N] indexed form', () => {
    expect(applySkillArguments('Tag $ARGUMENTS[0] as $ARGUMENTS[1]', 'v1.0 latest')).toBe(
      'Tag v1.0 as latest',
    )
  })

  it('substitutes named $name from argumentNames', () => {
    expect(
      applySkillArguments('Deploy $env with $tag', 'staging v2.0', {
        argumentNames: ['env', 'tag'],
      }),
    ).toBe('Deploy staging with v2.0')
  })

  it('respects \\$ escape — an escaped token receives nothing, so the arguments append', () => {
    // CC: "A placeholder is `$ARGUMENTS`, an indexed form ... or a named argument"; an escaped
    // one is literal text and receives no argument.
    expect(applySkillArguments('Use \\$ARGUMENTS literally', 'x')).toBe(
      'Use $ARGUMENTS literally\n\nARGUMENTS: x',
    )
    // Mixed: escaped stays literal, unescaped substitutes
    expect(applySkillArguments('literal: \\$ARGUMENTS; first: $0', 'hello world')).toBe(
      'literal: $ARGUMENTS; first: hello',
    )
  })

  it('substitutes ${CLAUDE_SESSION_ID} and ${CLAUDE_PROJECT_DIR}', () => {
    const result = applySkillArguments(
      'Session: ${CLAUDE_SESSION_ID} dir: ${CLAUDE_PROJECT_DIR}',
      '',
      { sessionId: 'ses-123', projectDir: '/repo' },
    )
    expect(result).toBe('Session: ses-123 dir: /repo')
  })

  it('does not append arguments when the template is empty and arg is non-empty', () => {
    // An empty body still gets the argument appended
    expect(applySkillArguments('', 'x')).toBe('\n\nARGUMENTS: x')
  })

  // CC skills.md: "An indexed placeholder with no corresponding argument ... stays in the content
  // unchanged"; "When no placeholder receives an argument, Claude Code appends them as
  // `ARGUMENTS: <value>`" — `${CLAUDE_*}` and a shell's own `$NAME` are not placeholders.
  it('leaves a missing indexed argument as written, and it receives nothing', () => {
    expect(applySkillArguments('IDX first=$0 third=$2 sixth=$ARGUMENTS[5]', 'only')).toBe(
      'IDX first=only third=$2 sixth=$ARGUMENTS[5]',
    )
    expect(applySkillArguments('third=$2', 'only')).toBe('third=$2\n\nARGUMENTS: only')
  })

  it('appends when only ${CLAUDE_*} variables or unknown $NAMEs appear', () => {
    expect(applySkillArguments('dir ${CLAUDE_SKILL_DIR}', 'one two', { skillDir: '/s' })).toBe(
      'dir /s\n\nARGUMENTS: one two',
    )
    expect(applySkillArguments('kill $VIEWER_PID', '42')).toBe('kill $VIEWER_PID\n\nARGUMENTS: 42')
  })

  it('decides from the authored source: a command that consumed $ARGUMENTS counts', () => {
    expect(applySkillArguments('ran: ok', 'a b', { sourceTemplate: '!`run $ARGUMENTS`' })).toBe(
      'ran: ok',
    )
  })

  it('counts a declared name even with no argument at its position', () => {
    expect(applySkillArguments('to $env', '', { argumentNames: ['env'] })).toBe('to ')
    expect(applySkillArguments('a=$a b=$b', 'x', { argumentNames: ['a', 'b'] })).toBe('a=x b=')
  })
})

describe('a plugin namespace with a dot', () => {
  it('parses /acme.tools:run as the plugin command, keeping a bare dotted word a prompt', () => {
    expect(parseSlashInvocation('/acme.tools:run now')).toEqual({
      name: 'acme.tools:run',
      arg: 'now',
    })
    expect(parseSlashInvocation('/v1.2 notes')).toBeNull()
  })
})
