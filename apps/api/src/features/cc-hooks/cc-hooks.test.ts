import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isMatchAll, matchesField, matchesToolName, toolNameCandidates } from './matcher'
import { buildCcHookRegistry, parseHooksBlock } from './config'
import { createCcHooksRuntime } from './run'
import type { CcHookHandler, CcHookRegistry } from './contracts'

const silentLogger = { warn: () => {}, info: () => {} }

// ---------------------------------------------------------------------------
// Matcher semantics
// ---------------------------------------------------------------------------
describe('matcher', () => {
  it('treats *, empty, and undefined as match-all', () => {
    expect(isMatchAll('*')).toBe(true)
    expect(isMatchAll('')).toBe(true)
    expect(isMatchAll('  ')).toBe(true)
    expect(isMatchAll(undefined)).toBe(true)
    expect(isMatchAll('Bash')).toBe(false)
  })

  it('exact single + | / , alternation (case-insensitive)', () => {
    expect(matchesField('startup', 'startup')).toBe(true)
    expect(matchesField('startup|resume', 'resume')).toBe(true)
    expect(matchesField('startup, resume', 'resume')).toBe(true)
    expect(matchesField('startup', 'clear')).toBe(false)
  })

  it('regex path for matchers with special chars', () => {
    expect(matchesToolName('mcp__memory__.*', 'mcp__memory__create')).toBe(true)
    expect(matchesToolName('mcp__memory__.*', 'mcp__github__search')).toBe(false)
  })

  it('maps CC tool names onto engine tool names', () => {
    // "Bash" matcher matches our engine `bash` tool.
    expect(matchesToolName('Bash', 'bash')).toBe(true)
    // "Grep"/"Glob" both map to engine `search`.
    expect(matchesToolName('Grep', 'search')).toBe(true)
    expect(matchesToolName('Glob', 'search')).toBe(true)
    // "Edit|Write" matches edit (Edit→edit) and write.
    expect(matchesToolName('Edit|Write', 'edit')).toBe(true)
    expect(matchesToolName('Edit|Write', 'write')).toBe(true)
    // Raw engine name also works.
    expect(matchesToolName('bash', 'bash')).toBe(true)
    // Non-matching.
    expect(matchesToolName('Bash', 'search')).toBe(false)
  })

  it('candidate set includes engine + CC aliases', () => {
    const c = toolNameCandidates('search')
    expect(c).toContain('search')
    expect(c).toContain('grep')
    expect(c).toContain('glob')
  })
})

// ---------------------------------------------------------------------------
// Config parsing + merging
// ---------------------------------------------------------------------------
describe('config parsing', () => {
  it('parses supported types and records skipped ones (unknown type + unknown event)', () => {
    const skipped: Parameters<typeof parseHooksBlock>[3] = []
    const reg = parseHooksBlock(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                { type: 'command', command: 'echo ok', timeout: 5 },
                // http IS supported on PreToolUse now (all five types).
                { type: 'http', url: 'http://x' },
                // unknown handler type → recorded as skipped, never thrown.
                { type: 'webhook', url: 'http://y' },
              ],
            },
          ],
          Unknown_Event: [{ hooks: [{ type: 'command', command: 'echo no' }] }],
        },
      },
      'project',
      { projectDir: '/proj' },
      skipped,
    )
    expect(reg.PreToolUse?.[0]?.handlers).toHaveLength(2)
    expect(reg.PreToolUse?.[0]?.handlers[0]?.timeoutMs).toBe(5000)
    expect(reg.PreToolUse?.[0]?.handlers[1]?.kind).toBe('http')
    expect(reg).not.toHaveProperty('Unknown_Event')
    expect(skipped).toEqual([{ source: 'project', event: 'PreToolUse', type: 'webhook' }])
  })

  // Pasting the path was command injection (a folder named `x$(touch PWNED)`); the shell expands
  // the placeholder from the env the executor sets, which is the real-shell test further down.
  it('leaves ${CLAUDE_PROJECT_DIR} / ${CLAUDE_PLUGIN_ROOT} for the shell + clamps timeout', () => {
    const reg = parseHooksBlock(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'run ${CLAUDE_PROJECT_DIR}/x ${CLAUDE_PLUGIN_ROOT}/y',
                  timeout: 9999,
                },
              ],
            },
          ],
        },
      },
      'plugin',
      { projectDir: '/proj', pluginName: 'p', pluginRoot: '/plug' },
    )
    const h = reg.Stop?.[0]?.handlers[0]
    expect(h?.command).toBe('run ${CLAUDE_PROJECT_DIR}/x ${CLAUDE_PLUGIN_ROOT}/y')
    expect(h?.pluginRoot).toBe('/plug')
    expect(h?.timeoutMs).toBe(1_800_000) // capped at 1800s (30 min)
    expect(h?.pluginName).toBe('p')
  })

  it('keeps ${CLAUDE_PLUGIN_DATA} for the shell and lazily creates the data dir', async () => {
    const dataDir = join(tmpdir(), `cc-plugin-data-${Date.now()}`, 'nested')
    const reg = parseHooksBlock(
      {
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'cp state ${CLAUDE_PLUGIN_DATA}/state.json' }] },
          ],
        },
      },
      'plugin',
      { projectDir: '/proj', pluginName: 'p', pluginRoot: '/plug', pluginDataDir: dataDir },
    )
    const h = reg.Stop?.[0]?.handlers[0]
    expect(h?.command).toBe('cp state ${CLAUDE_PLUGIN_DATA}/state.json')
    expect(h?.pluginDataDir).toBe(dataDir)
    // Referencing the token created the dir so the hook's shell can use it.
    expect((await fs.stat(dataDir)).isDirectory()).toBe(true)
    await rm(join(dataDir, '..'), { recursive: true, force: true })
  })

  it('binds non-sensitive ${user_config.KEY} as env, keeps sensitive tokens + bare shell vars verbatim', () => {
    const reg = parseHooksBlock(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command:
                    'deploy --region ${user_config.REGION} --token ${user_config.API_TOKEN} --tries ${user_config.MISSING:-3} --home ${HOME}',
                },
              ],
            },
          ],
        },
      },
      'plugin',
      {
        projectDir: '/proj',
        pluginName: 'p',
        pluginRoot: '/plug',
        config: { REGION: 'eu-1', API_TOKEN: 's3cret' },
        isSensitive: (key) => key === 'API_TOKEN',
      },
    )
    const h = reg.Stop?.[0]?.handlers[0]
    // Non-sensitive keys become variables the shell expands (a value is never parsed as
    // source); sensitive left verbatim (shell-form rule); an unset key is bound EMPTY so its
    // :-fallback applies and an ambient variable cannot stand in; bare ${HOME} is untouched.
    // Every option, sensitive included, also reaches the process as CLAUDE_PLUGIN_OPTION_<KEY>.
    expect(h?.command).toBe(
      'deploy --region ${CLAUDE_PLUGIN_OPTION_REGION} --token ${user_config.API_TOKEN} --tries ${CLAUDE_PLUGIN_OPTION_MISSING:-3} --home ${HOME}',
    )
    expect(h?.shellEnv).toEqual({
      CLAUDE_PLUGIN_OPTION_REGION: 'eu-1',
      CLAUDE_PLUGIN_OPTION_API_TOKEN: 's3cret',
      CLAUDE_PLUGIN_OPTION_MISSING: '',
    })
  })

  // The defect, end to end through a real `sh -c`: both the project path and a config value used
  // to be pasted into the command text, so either one could run a command of its own.
  it('runs a hook in a hostile project dir with a hostile config value without executing either', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-hook-inject-'))
    try {
      // `${IFS}` instead of a space: pasted, it still ran; expanded unquoted, it does not split.
      const projectDir = join(root, 'x$(touch${IFS}PWNED_DIR)`touch${IFS}PWNED_TICK`')
      await fs.mkdir(projectDir, { recursive: true })
      const reg = parseHooksBlock(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: 'command',
                    command:
                      'cat >/dev/null; printf "%s|%s|%s" ${CLAUDE_PROJECT_DIR} "$CLAUDE_PROJECT_DIR" "${user_config.NAME}"',
                  },
                ],
              },
            ],
          },
        },
        'plugin',
        {
          projectDir,
          pluginName: 'p',
          pluginRoot: '/plug',
          config: { NAME: `'; touch PWNED_CFG; echo '$(touch PWNED_CFG2)` },
        },
      )
      const rt = createCcHooksRuntime({
        registry: reg,
        sessionId: 's1',
        projectDir,
        enabled: true,
        logger: { warn: () => {} },
      })
      const out = await rt.runSessionStart()
      for (const marker of ['PWNED_DIR', 'PWNED_TICK', 'PWNED_CFG', 'PWNED_CFG2']) {
        expect(await fs.stat(join(projectDir, marker)).catch(() => null)).toBeNull()
        expect(await fs.stat(join(root, marker)).catch(() => null)).toBeNull()
      }
      // The values arrived as data: the path both unquoted and quoted, the config value whole.
      expect(out).toEqual({
        additionalContext: `${projectDir}|${projectDir}|'; touch PWNED_CFG; echo '$(touch PWNED_CFG2)`,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('defaults an omitted timeout to the CC 600s command default', () => {
    const reg = parseHooksBlock(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      'user',
      { projectDir: '/proj' },
    )
    expect(reg.Stop?.[0]?.handlers[0]?.timeoutMs).toBe(600_000)
  })

  let home: string
  let proj: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cchome-'))
    proj = await mkdtemp(join(tmpdir(), 'ccproj-'))
    await fs.mkdir(join(home, '.claude'), { recursive: true })
    await fs.mkdir(join(proj, '.claude'), { recursive: true })
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(proj, { recursive: true, force: true })
  })

  it('loads enabled-plugin hooks and ignores ambient Claude settings hooks', async () => {
    await fs.writeFile(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user' }] }] } }),
    )
    await fs.writeFile(
      join(proj, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'project' }] }] } }),
    )
    await fs.writeFile(
      join(proj, '.claude', 'settings.local.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'local' }] }] } }),
    )
    const { registry } = await buildCcHookRegistry({
      projectDir: proj,
      pluginHooks: [
        {
          pluginName: 'p',
          pluginRoot: '/plug',
          dataDir: '/plug-data',
          raw: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'plugin' }] }] } },
        },
      ],
    })
    const cmds = registry.Stop?.map((g) => g.handlers[0]?.command)
    expect(cmds).toEqual(['plugin'])
  })

  it('threads plugin dataDir + config + sensitiveKeys through buildCcHookRegistry', async () => {
    const dataDir = join(proj, 'plugin-data', 'p')
    const { registry } = await buildCcHookRegistry({
      projectDir: proj,
      pluginHooks: [
        {
          pluginName: 'p',
          pluginRoot: '/plug',
          dataDir,
          config: { REGION: 'eu-1', API_TOKEN: 's3cret' },
          sensitiveKeys: ['API_TOKEN'],
          raw: {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: 'command',
                      command:
                        'sync ${CLAUDE_PLUGIN_DATA} --region ${user_config.REGION} --token ${user_config.API_TOKEN}',
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    })
    const h = registry.Stop?.[0]?.handlers[0]
    expect(h?.command).toBe(
      'sync ${CLAUDE_PLUGIN_DATA} --region ${CLAUDE_PLUGIN_OPTION_REGION} --token ${user_config.API_TOKEN}',
    )
    expect(h?.shellEnv).toEqual({
      CLAUDE_PLUGIN_OPTION_REGION: 'eu-1',
      CLAUDE_PLUGIN_OPTION_API_TOKEN: 's3cret',
    })
    expect(h?.pluginDataDir).toBe(dataDir)
    expect((await fs.stat(dataDir)).isDirectory()).toBe(true)
  })

  it('ambient settings files contribute nothing', async () => {
    await fs.writeFile(join(proj, '.claude', 'settings.json'), '{ not valid json')
    const { registry } = await buildCcHookRegistry({ projectDir: proj })
    expect(Object.keys(registry)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Runtime + executor protocol (real sh -c spawns)
// ---------------------------------------------------------------------------
function reg(handlers: Partial<Record<keyof CcHookRegistry, CcHookHandler[]>>): CcHookRegistry {
  const out: CcHookRegistry = {}
  for (const [event, hs] of Object.entries(handlers))
    out[event as keyof CcHookRegistry] = [{ handlers: hs as CcHookHandler[] }]
  return out
}
const cmd = (command: string, extra?: Partial<CcHookHandler>): CcHookHandler => ({
  source: 'user',
  command,
  timeoutMs: 5000,
  ...extra,
})

describe('runtime protocol', () => {
  const make = (registry: CcHookRegistry, enabled = true) =>
    createCcHooksRuntime({
      registry,
      sessionId: 's1',
      projectDir: tmpdir(),
      enabled,
      logger: silentLogger,
    })

  it('inert when disabled or empty', async () => {
    expect(make({}).active).toBe(false)
    expect(make(reg({ Stop: [cmd('echo x')] }), false).active).toBe(false)
  })

  it('exports CLAUDE_PLUGIN_DATA into the hook child env', async () => {
    const rt = make(
      reg({
        SessionStart: [
          cmd('cat >/dev/null; echo "data:$CLAUDE_PLUGIN_DATA"', { pluginDataDir: '/tmp/pdata' }),
        ],
      }),
    )
    expect(await rt.runSessionStart()).toEqual({ additionalContext: 'data:/tmp/pdata' })
  })

  it('SessionStart plain-text stdout becomes additionalContext', async () => {
    const rt = make(reg({ SessionStart: [cmd('cat >/dev/null; echo "branch: main"')] }))
    expect(await rt.runSessionStart()).toEqual({ additionalContext: 'branch: main' })
  })

  it('SessionStart matches on + reports the source (startup/clear/compact)', async () => {
    const rt = make({
      SessionStart: [
        { matcher: 'compact', handlers: [cmd('cat >/dev/null; echo "compacted"')] },
        { matcher: 'startup', handlers: [cmd('cat >/dev/null; echo "started"')] },
      ],
    })
    // Source drives the matcher: a `compact`-matched hook only fires on `compact`.
    expect(await rt.runSessionStart('compact')).toEqual({ additionalContext: 'compacted' })
    expect(await rt.runSessionStart('startup')).toEqual({ additionalContext: 'started' })
    // Default source is `startup`.
    expect(await rt.runSessionStart()).toEqual({ additionalContext: 'started' })
  })

  it('SessionStart passes the source in the hook input JSON', async () => {
    const rt = make(
      reg({
        SessionStart: [
          cmd(`S=$(cat | sed -n 's/.*"source":"\\([^"]*\\)".*/\\1/p'); echo "src:$S"`),
        ],
      }),
    )
    expect(await rt.runSessionStart('clear')).toEqual({ additionalContext: 'src:clear' })
  })

  it('PreCompact: manual trigger passes custom_instructions + exit 2 blocks', async () => {
    const rt = make(
      reg({
        PreCompact: [
          cmd(
            `I=$(cat | sed -n 's/.*"custom_instructions":"\\([^"]*\\)".*/\\1/p'); echo "$I" >&2; exit 2`,
          ),
        ],
      }),
    )
    const r = await rt.runPreCompact('manual', 'keep the api notes')
    expect(r.blocked).toBe(true)
    expect(r.reason).toBe('keep the api notes')
  })

  it('Notification: fires a hook and passes message + notification_type in the JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notif-'))
    const out = join(dir, 'seen.txt')
    const rt = make(
      reg({
        Notification: [
          cmd(
            `T=$(cat | sed -n 's/.*"notification_type":"\\([^"]*\\)".*/\\1/p'); echo "$T" > ${out}`,
          ),
        ],
      }),
    )
    await rt.runNotification({
      message: 'Agent needs input: Approve bash?',
      notificationType: 'permission_prompt',
    })
    expect((await fs.readFile(out, 'utf8')).trim()).toBe('permission_prompt')
    await rm(dir, { recursive: true, force: true })
  })

  it('Notification: matcher filters on notification_type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notif-'))
    const out = join(dir, 'hits.txt')
    const rt = make({
      Notification: [
        { matcher: 'permission_prompt', handlers: [cmd(`cat >/dev/null; echo hit >> ${out}`)] },
      ],
    })
    // A non-matching type does not fire the hook.
    await rt.runNotification({ message: 'x', notificationType: 'agent_needs_input' })
    let hits = await fs.readFile(out, 'utf8').catch(() => '')
    expect(hits.trim()).toBe('')
    // The matching type does.
    await rt.runNotification({ message: 'y', notificationType: 'permission_prompt' })
    hits = await fs.readFile(out, 'utf8')
    expect(hits.trim()).toBe('hit')
    await rm(dir, { recursive: true, force: true })
  })

  it('Notification: inert when no Notification hooks are registered', async () => {
    const rt = make(reg({ Stop: [cmd('echo x')] }))
    // No throw, no-op.
    await rt.runNotification({ message: 'nothing listens', notificationType: 'permission_prompt' })
  })

  it('PreCompact: matcher filters on trigger (manual vs auto)', async () => {
    const rt = make({
      PreCompact: [{ matcher: 'manual', handlers: [cmd('cat >/dev/null; exit 2')] }],
    })
    expect((await rt.runPreCompact('manual')).blocked).toBe(true)
    expect((await rt.runPreCompact('auto')).blocked).toBe(false)
  })

  it('UserPromptSubmit: exit 2 blocks with stderr reason', async () => {
    const rt = make(
      reg({ UserPromptSubmit: [cmd('cat >/dev/null; echo "no secrets" >&2; exit 2')] }),
    )
    const r = await rt.runUserPromptSubmit('hi')
    expect(r.blocked).toBe(true)
    expect(r.reason).toBe('no secrets')
  })

  it('UserPromptSubmit: JSON additionalContext is injected', async () => {
    const rt = make(
      reg({
        UserPromptSubmit: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CI is green"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runUserPromptSubmit('hi')
    expect(r.blocked).toBe(false)
    expect(r.additionalContext).toBe('CI is green')
  })

  it('UserPromptSubmit: receives the prompt on stdin', async () => {
    // Hook echoes the submitted prompt back as context so we can assert stdin plumbing.
    const rt = make(
      reg({
        UserPromptSubmit: [
          cmd(`P=$(cat | sed -n 's/.*"prompt":"\\([^"]*\\)".*/\\1/p'); echo "saw:$P"`),
        ],
      }),
    )
    const r = await rt.runUserPromptSubmit('deploy now')
    expect(r.additionalContext).toBe('saw:deploy now')
  })

  it('PreToolUse: permissionDecision deny denies the call', async () => {
    const rt = make(
      reg({
        PreToolUse: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked rm"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPreToolUse('bash', { command: 'rm -rf /' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('blocked rm')
  })

  it('PreToolUse: updatedInput rewrites the tool input', async () => {
    const rt = make(
      reg({
        PreToolUse: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"ls"}}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPreToolUse('bash', { command: 'rm -rf /' })
    expect(r.decision).toBe('proceed')
    expect(r.didRewrite).toBe(true)
    expect(r.updatedInput).toEqual({ command: 'ls' })
  })

  it('PreToolUse: matcher scopes which tools fire', async () => {
    const rt = make({
      PreToolUse: [
        {
          matcher: 'Bash',
          handlers: [
            cmd(
              `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}'`,
            ),
          ],
        },
      ],
    })
    expect((await rt.runPreToolUse('bash', {})).decision).toBe('deny')
    expect((await rt.runPreToolUse('read', {})).decision).toBe('proceed') // matcher Bash doesn't match read
  })

  it('PostToolUse: additionalContext surfaced for the caller to append', async () => {
    const rt = make(
      reg({
        PostToolUse: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"file is generated"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPostToolUse('write', { file_path: '/x' }, { content: 'done' })
    expect(r.additionalContext).toBe('file is generated')
  })

  it('PostToolUseFailure: sees the error on stdin and adds context', async () => {
    const rt = make(
      reg({
        PostToolUseFailure: [
          cmd(
            `grep -q '"error":"disk on fire"' && echo '{"hookSpecificOutput":{"hookEventName":"PostToolUseFailure","additionalContext":"retry later"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPostToolUseFailure(
      'bash',
      { command: 'x' },
      { error: 'disk on fire', isInterrupt: false },
    )
    expect(r.additionalContext).toBe('retry later')
  })

  it('PostToolUse: updatedToolOutput replaces the model-facing result content', async () => {
    const rt = make(
      reg({
        PostToolUse: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":"[REDACTED]"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPostToolUse('bash', { command: 'cat secrets' }, { content: 'hunter2' })
    expect(r.updatedToolOutput).toBe('[REDACTED]')
  })

  it('PostToolUse: a later hook observes the earlier hook’s replaced output; last replacement wins', async () => {
    const rt = make(
      reg({
        PostToolUse: [
          // first hook replaces the content with AAA
          cmd(
            `echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":"AAA"}}'`,
          ),
          // second hook's stdin must now carry "content":"AAA" (the replaced value), not the original
          cmd(
            `grep -q '"content":"AAA"' && echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":"chained"}}' || echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":"unchained"}}'`,
          ),
        ],
      }),
    )
    const r = await rt.runPostToolUse('bash', { command: 'x' }, { content: 'orig' })
    // second hook saw the replaced content → last replacement wins
    expect(r.updatedToolOutput).toBe('chained')
  })

  it('Stop: runs side-effect hooks and reports a block decision', async () => {
    const rt = make(
      reg({ Stop: [cmd(`cat >/dev/null; echo '{"decision":"block","reason":"tests failing"}'`)] }),
    )
    expect(await rt.runStop()).toEqual({ blocked: true, reason: 'tests failing' })
  })

  it('non-{0,2} exit is non-blocking', async () => {
    const rt = make(reg({ UserPromptSubmit: [cmd('cat >/dev/null; echo boom >&2; exit 1')] }))
    expect((await rt.runUserPromptSubmit('hi')).blocked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// systemMessage → emitNotice (non-blocking user-facing warning)
// ---------------------------------------------------------------------------
describe('systemMessage notices', () => {
  const makeWith = (registry: CcHookRegistry, emitNotice?: (m: string, e: string) => void) =>
    createCcHooksRuntime({
      registry,
      sessionId: 's1',
      projectDir: tmpdir(),
      enabled: true,
      logger: silentLogger,
      emitNotice,
    })

  it('a hook systemMessage is emitted with its event name', async () => {
    const notices: Array<[string, string]> = []
    const rt = makeWith(
      reg({ PostToolUse: [cmd(`cat >/dev/null; echo '{"systemMessage":"heads up: prod db"}'`)] }),
      (m, e) => notices.push([m, e]),
    )
    await rt.runPostToolUse('write', { file_path: '/x' }, { content: 'done' })
    expect(notices).toEqual([['heads up: prod db', 'PostToolUse']])
  })

  it('systemMessage rides alongside a normal outcome (non-blocking)', async () => {
    const notices: string[] = []
    const rt = makeWith(
      reg({
        PreToolUse: [
          cmd(
            `cat >/dev/null; echo '{"systemMessage":"careful","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'`,
          ),
        ],
      }),
      (m) => notices.push(m),
    )
    const r = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(r.decision).toBe('allow')
    expect(notices).toEqual(['careful'])
  })

  it('identical consecutive systemMessages are de-duped', async () => {
    const notices: string[] = []
    const rt = makeWith(
      reg({ PreToolUse: [cmd(`cat >/dev/null; echo '{"systemMessage":"same warning"}'`)] }),
      (m) => notices.push(m),
    )
    await rt.runPreToolUse('bash', { command: 'a' })
    await rt.runPreToolUse('bash', { command: 'b' })
    await rt.runPreToolUse('bash', { command: 'c' })
    expect(notices).toEqual(['same warning']) // fired once, then deduped
  })

  it('no systemMessage → no notice', async () => {
    const notices: string[] = []
    const rt = makeWith(
      reg({
        PostToolUse: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"ctx only"}}'`,
          ),
        ],
      }),
      (m) => notices.push(m),
    )
    await rt.runPostToolUse('write', { file_path: '/x' }, { content: 'done' })
    expect(notices).toEqual([])
  })
})
