/** Session E2E: Claude Code tool hooks — what a hook reads (stdin, env, options) and which matchers fire. */
import assert from 'node:assert/strict'
import path from 'node:path'

import { bash } from './scenarios-cc-helpers.mjs'
import { labels, on, once, optionScenario } from './scenarios-cc-tool-hooks-helpers.mjs'

export const CC_TOOL_HOOK_INPUT_SCENARIOS = [
  {
    name: 'cc-tool-hooks: PreToolUse stdin names each tool as Claude Code does and carries its call',
    async run(rt) {
      const file = 'ccth-input.txt'
      const calls = [
        bash('printf ccth-input'),
        { tool: 'write', args: { files: [{ path: file, content: 'alpha' }] } },
        {
          tool: 'edit',
          args: { edits: [{ path: file, old_string: 'alpha', new_string: 'beta' }] },
        },
        { tool: 'read', args: { path: file } },
        { tool: 'search', args: { query: 'ccth-needle' } },
      ]
      const hooks = (h) => on('PreToolUse', '*', h('pre'))
      const { got } = await once(rt, 'ccth-input', { hooks, calls })
      // Built-in tools "such as Bash, … Edit, Write, Read, Glob, Grep" (hooks.md, PreToolUse).
      assert.deepEqual(
        got.map((r) => r.tool_name),
        ['Bash', 'Write', 'Edit', 'Read', 'Grep'],
      )
      for (const r of got) {
        // Common input fields, and "PreToolUse hooks receive tool_name, tool_input, tool_use_id".
        assert.ok(r.session_id && path.isAbsolute(r.cwd), 'session_id and cwd')
        assert.equal(r.hook_event_name, 'PreToolUse')
        assert.ok(typeof r.tool_use_id === 'string' && r.tool_use_id, 'tool_use_id')
      }
      assert.equal(new Set(got.map((r) => r.tool_use_id)).size, 5, 'one id per call')
      const [b, w, e, rd, g] = got.map((r) => r.tool_input)
      // Per-tool tool_input fields: Bash `command`; Write `file_path`, `content`; Edit
      // `file_path`, `old_string`, `new_string`; Read `file_path`; Grep `pattern`.
      assert.equal(b.command, 'printf ccth-input')
      assert.deepEqual([w.file_path.endsWith(file), w.content], [true, 'alpha'])
      assert.deepEqual(
        [e.file_path.endsWith(file), e.old_string, e.new_string],
        [true, 'alpha', 'beta'],
      )
      assert.ok(rd.file_path.endsWith(file))
      assert.equal(g.pattern, 'ccth-needle')
    },
  },
  {
    name: 'cc-tool-hooks: PreToolUse stdin carries transcript_path, permission_mode and absolute file paths',
    async run(rt) {
      const calls = [{ tool: 'write', args: { files: [{ path: 'ccth-abs.txt', content: 'x' }] } }]
      const hooks = (h) => on('PreToolUse', 'Write', h('pre'))
      const [r] = (await once(rt, 'ccth-input2', { hooks, calls })).got
      // One comparison, so a failure names every field still off.
      const got = {
        transcript_path: r.transcript_path,
        permission_mode: r.permission_mode,
        file_path: r.tool_input.file_path,
      }
      assert.deepEqual(
        got,
        {
          // "transcript_path: Path to conversation JSON".
          transcript_path: r.transcript_path || '(a path)',
          // The PreToolUse example carries "permission_mode": "default".
          permission_mode: 'default',
          // "For the file tools Write, Edit, and Read, tool_input.file_path is always absolute".
          file_path: path.resolve(r.cwd, r.tool_input.file_path),
        },
        JSON.stringify(got),
      )
    },
  },
  {
    name: 'cc-tool-hooks: a plugin hook gets CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA and its options',
    run: (rt) => optionScenario(rt, 'ccth-env', undefined, 'https://default.example'),
  },
  {
    name: 'cc-tool-hooks: an option value the person set reaches CLAUDE_PLUGIN_OPTION_<KEY> and exec args',
    run: (rt) => optionScenario(rt, 'ccth-env2', 'https://set.example', 'https://set.example'),
  },
  {
    name: 'cc-tool-hooks: matchers — exact, | and , lists, regex, * , empty and omitted',
    async run(rt) {
      const groups = {
        exact: 'Bash',
        pipe: 'Edit|Bash',
        comma: 'Read, Write',
        regex: '.as.',
        lettersOnly: 'as',
        star: '*',
        empty: '',
        omitted: undefined,
        mcp: 'mcp__memory',
      }
      const hooks = (h) => ({
        PreToolUse: Object.entries(groups).map(([label, matcher]) => ({
          ...(matcher === undefined ? {} : { matcher }),
          hooks: [h(label)],
        })),
      })
      const calls = [bash('printf ccth-match'), { tool: 'read', args: { path: '.' } }]
      const { got } = await once(rt, 'ccth-match', { hooks, calls })
      const fired = (tool) => labels(got.filter((r) => r.tool_name === tool)).sort()
      // `Bash` exact, `Edit|Bash` a list, `.as.` a regex (unanchored), `*`, `""` and omitted all
      // match; `as` and `mcp__memory` hold only exact-match characters, so they match no tool.
      assert.deepEqual(fired('Bash'), ['empty', 'exact', 'omitted', 'pipe', 'regex', 'star'])
      // `Read, Write`: "list of exact strings separated by | or ,".
      assert.deepEqual(fired('Read'), ['comma', 'empty', 'omitted', 'star'])
    },
  },
  {
    name: 'cc-tool-hooks: a regex matcher is tested against Claude Code’s tool name — `^Bash$` and `Edit.*` fire',
    async run(rt) {
      const hooks = (h) => ({
        PreToolUse: [
          { matcher: '^Bash$', hooks: [h('anchored')] },
          { matcher: 'Edit.*', hooks: [h('edit')] },
        ],
      })
      const file = 'ccth-case.txt'
      const calls = [
        { tool: 'write', args: { files: [{ path: file, content: 'alpha' }] } },
        { tool: 'edit', args: { edits: [{ path: file, old_string: 'alpha', new_string: 'b' }] } },
        bash('printf ccth-case'),
      ]
      const { got } = await once(rt, 'ccth-case', { hooks, calls })
      // "A matcher on the regular-expression path is tested with JavaScript's
      // RegExp.prototype.test"; "`Edit.*` matches both `Edit` and `NotebookEdit`; wrap the pattern
      // in `^` and `$`, as in `^Edit$`" (hooks.md, Matcher patterns). Write matches neither.
      assert.deepEqual(
        got.map((r) => [r.tool_name, r._label]),
        [
          ['Edit', 'edit'],
          ['Bash', 'anchored'],
        ],
      )
    },
  },
  {
    name: 'cc-tool-hooks: an `if` wildcard stands in for any text, slashes included',
    async run(rt) {
      const hooks = (h) => on('PreToolUse', 'Bash', h('if', { if: 'Bash(cat *ccth-if*)' }))
      const calls = [bash('cat ./missing/ccth-if.txt')]
      // permissions.md, Wildcard patterns: "The `*` stands in for whatever text is in its place".
      assert.equal((await once(rt, 'ccth-ifglob', { hooks, calls })).got.length, 1)
    },
  },
]
