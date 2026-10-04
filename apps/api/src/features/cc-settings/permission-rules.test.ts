import { describe, it, expect } from 'bun:test'
import {
  parseCcPermissionRules,
  evaluateCcRules,
  describeCcRuleMatch,
  type CcPermissionBlock,
  type CcRuleCall,
} from './permission-rules'

// ── helpers ──────────────────────────────────────────────────────────────────

function block(partial: Partial<CcPermissionBlock>): CcPermissionBlock {
  return {
    scope: 'project',
    path: '/proj/.claude/settings.json',
    allow: [],
    deny: [],
    ask: [],
    additionalDirectories: [],
    ...partial,
  }
}

function call(partial: Partial<CcRuleCall> & { engineToolName: string }): CcRuleCall {
  return {
    input: {},
    paths: [],
    filePaths: [],
    root: '/proj',
    home: '/home/u',
    ...partial,
  }
}

function evalRule(tier: 'allow' | 'deny' | 'ask', rules: string[], c: CcRuleCall) {
  const parsed = parseCcPermissionRules([block({ [tier]: rules } as Partial<CcPermissionBlock>)])
  return evaluateCcRules(parsed, c)
}

// ── parsing ────────────────────────────────────────────────────────────────

describe('parsing', () => {
  it('parses bare tool and Tool(specifier)', () => {
    const rules = parseCcPermissionRules([block({ deny: ['Bash', 'Bash(git push:*)'] })])
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ tool: 'Bash', tier: 'deny' })
    expect(rules[0]!.specifier).toBeUndefined()
    expect(rules[1]).toMatchObject({
      tool: 'Bash',
      tier: 'deny',
      specifier: 'git push:*',
    })
  })

  it('tags each rule with its source scope + path', () => {
    const rules = parseCcPermissionRules([
      block({
        scope: 'user',
        path: '/u/.claude/settings.json',
        allow: ['Read(*)'],
      }),
      block({
        scope: 'local',
        path: '/proj/.claude/settings.local.json',
        deny: ['Bash'],
      }),
    ])
    expect(rules[0]!.source).toEqual({
      scope: 'user',
      path: '/u/.claude/settings.json',
    })
    expect(rules[1]!.source).toEqual({
      scope: 'local',
      path: '/proj/.claude/settings.local.json',
    })
  })

  it('skips empty / blank rule strings', () => {
    expect(parseCcPermissionRules([block({ allow: ['', '   '] })])).toHaveLength(0)
  })
})

// ── tier precedence ──────────────────────────────────────────────────────────

describe('tier precedence (deny > ask > allow)', () => {
  const c = call({ engineToolName: 'bash', command: 'rm -rf /tmp/x' })

  it('deny wins over ask and allow for the same call', () => {
    const rules = parseCcPermissionRules([
      block({ allow: ['Bash'], ask: ['Bash'], deny: ['Bash'] }),
    ])
    expect(evaluateCcRules(rules, c)!.action).toBe('deny')
  })

  it('ask wins over allow when no deny matches', () => {
    const rules = parseCcPermissionRules([block({ allow: ['Bash'], ask: ['Bash'] })])
    expect(evaluateCcRules(rules, c)!.action).toBe('ask')
  })

  it('allow when only allow matches', () => {
    const rules = parseCcPermissionRules([block({ allow: ['Bash'] })])
    expect(evaluateCcRules(rules, c)!.action).toBe('allow')
  })

  it('no opinion (undefined) when nothing matches', () => {
    const rules = parseCcPermissionRules([block({ deny: ['Bash(git *)'] })])
    expect(
      evaluateCcRules(rules, call({ engineToolName: 'bash', command: 'ls -la' })),
    ).toBeUndefined()
  })

  it('merges rules across scopes (deny at any scope applies)', () => {
    const rules = parseCcPermissionRules([
      block({ scope: 'user', allow: ['Bash'] }),
      block({ scope: 'local', deny: ['Bash(rm *)'] }),
    ])
    expect(evaluateCcRules(rules, c)!.action).toBe('deny')
  })
})

// ── Bash grammar ─────────────────────────────────────────────────────────────

describe('Bash specifier grammar', () => {
  const mk = (command: string) => call({ engineToolName: 'bash', command })

  it('word-boundary prefix `git:*` matches subcommands, not `github`', () => {
    expect(evalRule('deny', ['Bash(git:*)'], mk('git push origin'))!.action).toBe('deny')
    expect(evalRule('deny', ['Bash(git:*)'], mk('git'))!.action).toBe('deny')
    expect(evalRule('deny', ['Bash(git:*)'], mk('github-cli status'))).toBeUndefined()
  })

  it('trailing space-glob `ls *` is a word boundary (matches `ls -la`, not `lsof`)', () => {
    expect(evalRule('deny', ['Bash(ls *)'], mk('ls -la'))!.action).toBe('deny')
    expect(evalRule('deny', ['Bash(ls *)'], mk('lsof'))).toBeUndefined()
  })

  it('raw prefix `ls*` (no space) matches `lsof` too', () => {
    expect(evalRule('deny', ['Bash(ls*)'], mk('lsof'))!.action).toBe('deny')
  })

  it('exact match requires the whole command', () => {
    expect(evalRule('deny', ['Bash(git status)'], mk('git status'))!.action).toBe('deny')
    expect(evalRule('deny', ['Bash(git status)'], mk('git status -s'))).toBeUndefined()
  })

  it('mid-pattern glob', () => {
    expect(evalRule('deny', ['Bash(git * --force)'], mk('git push --force'))!.action).toBe('deny')
  })

  it('deny/ask match ANY subcommand of a compound command', () => {
    expect(evalRule('deny', ['Bash(rm:*)'], mk('cd /tmp && rm -rf x'))!.action).toBe('deny')
  })

  it('allow requires ALL subcommands to match (conservative)', () => {
    expect(evalRule('allow', ['Bash(git:*)'], mk('git status && git push'))!.action).toBe('allow')
    expect(evalRule('allow', ['Bash(git:*)'], mk('git status && rm -rf x'))).toBeUndefined()
  })

  it('command substitution is treated as unmatchable (fail-safe, no confident match)', () => {
    expect(evalRule('deny', ['Bash(rm:*)'], mk('rm $(cat list)'))).toBeUndefined()
  })
})

// ── Read/Edit/Write path grammar ─────────────────────────────────────────────

describe('path grammar (gitignore anchors)', () => {
  it('bare filename matches at any depth (Read(.env) ≡ **/.env)', () => {
    expect(
      evalRule('deny', ['Read(.env)'], call({ engineToolName: 'read', paths: ['/proj/sub/.env'] }))!
        .action,
    ).toBe('deny')
    expect(
      evalRule('deny', ['Read(.env)'], call({ engineToolName: 'read', paths: ['/proj/.env'] }))!
        .action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['Read(.env)'],
        call({ engineToolName: 'read', paths: ['/proj/.environment'] }),
      ),
    ).toBeUndefined()
  })

  it('project-root anchor `/secrets` matches only at the root', () => {
    expect(
      evalRule(
        'deny',
        ['Read(/secrets/key)'],
        call({ engineToolName: 'read', paths: ['/proj/secrets/key'] }),
      )!.action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['Read(/secrets/key)'],
        call({ engineToolName: 'read', paths: ['/proj/sub/secrets/key'] }),
      ),
    ).toBeUndefined()
  })

  it('home anchor `~/` resolves against home', () => {
    expect(
      evalRule(
        'deny',
        ['Read(~/.ssh/id_rsa)'],
        call({ engineToolName: 'read', paths: ['/home/u/.ssh/id_rsa'] }),
      )!.action,
    ).toBe('deny')
  })

  it('absolute anchor `//etc`', () => {
    expect(
      evalRule(
        'deny',
        ['Read(//etc/passwd)'],
        call({ engineToolName: 'read', paths: ['/etc/passwd'] }),
      )!.action,
    ).toBe('deny')
  })

  it('subpath glob `src/**/*.ts`', () => {
    expect(
      evalRule(
        'allow',
        ['Edit(src/**/*.ts)'],
        call({
          engineToolName: 'apply_patch',
          filePaths: ['/proj/src/a/b.ts'],
        }),
      )!.action,
    ).toBe('allow')
    expect(
      evalRule(
        'allow',
        ['Edit(src/**/*.ts)'],
        call({ engineToolName: 'write', filePaths: ['/proj/src/x.ts'] }),
      )!.action,
    ).toBe('allow')
  })

  it('Edit/Write rules cover BOTH write and apply_patch engine tools', () => {
    expect(
      evalRule(
        'deny',
        ['Write(.env)'],
        call({ engineToolName: 'apply_patch', filePaths: ['/proj/.env'] }),
      )!.action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['Edit(.env)'],
        call({ engineToolName: 'write', filePaths: ['/proj/.env'] }),
      )!.action,
    ).toBe('deny')
  })

  // The old compiler matched `{env,pem}` as literal text, so this deny rule covered no
  // real file and secrets stayed readable while the rule looked active.
  it('brace alternatives in a deny rule cover every listed extension', () => {
    const rule = ['Read(**/*.{env,pem})']
    for (const p of ['/proj/.env', '/proj/config/prod.env', '/proj/certs/server.pem']) {
      expect(evalRule('deny', rule, call({ engineToolName: 'read', paths: [p] }))!.action).toBe(
        'deny',
      )
    }
    expect(
      evalRule('deny', rule, call({ engineToolName: 'read', paths: ['/proj/src/index.ts'] })),
    ).toBeUndefined()
  })

  it('character classes match one char of the class', () => {
    const rule = ['Read(/keys/id[0-9].txt)']
    expect(
      evalRule('deny', rule, call({ engineToolName: 'read', paths: ['/proj/keys/id7.txt'] }))!
        .action,
    ).toBe('deny')
    expect(
      evalRule('deny', rule, call({ engineToolName: 'read', paths: ['/proj/keys/idx.txt'] })),
    ).toBeUndefined()
  })

  it('Bash specifiers stay wildcard-only: braces are the literal text typed', () => {
    const rule = ['Bash(echo {a,b} *)']
    expect(
      evalRule('allow', rule, call({ engineToolName: 'bash', command: 'echo {a,b} hi' }))!.action,
    ).toBe('allow')
    expect(
      evalRule('allow', rule, call({ engineToolName: 'bash', command: 'echo a hi' })),
    ).toBeUndefined()
  })
})

// ── WebFetch ──────────────────────────────────────────────────────────────────

describe('WebFetch(domain:…)', () => {
  const mk = (url: string) => call({ engineToolName: 'mcp_web_fetch', input: { url } })

  it('exact domain', () => {
    expect(
      evalRule('deny', ['WebFetch(domain:example.com)'], mk('https://example.com/x'))!.action,
    ).toBe('deny')
    expect(
      evalRule('deny', ['WebFetch(domain:example.com)'], mk('https://other.com/x')),
    ).toBeUndefined()
  })

  it('*.sub matches subdomains at any depth but not the apex', () => {
    expect(
      evalRule('deny', ['WebFetch(domain:*.example.com)'], mk('https://a.b.example.com'))!.action,
    ).toBe('deny')
    expect(
      evalRule('deny', ['WebFetch(domain:*.example.com)'], mk('https://example.com')),
    ).toBeUndefined()
  })

  it('no url input → no match', () => {
    expect(
      evalRule(
        'deny',
        ['WebFetch(domain:example.com)'],
        call({ engineToolName: 'bash', command: 'ls' }),
      ),
    ).toBeUndefined()
  })

  it('matches direct research URLs, URL arrays, and provider-neutral domain filters', () => {
    expect(
      evalRule(
        'deny',
        ['WebFetch(domain:evil.com)'],
        call({
          engineToolName: 'research',
          input: { urls: ['https://evil.com/x'] },
        }),
      )!.action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['WebFetch(domain:evil.com)'],
        call({
          engineToolName: 'research',
          input: { include_domains: ['https://evil.com/docs'] },
        }),
      )!.action,
    ).toBe('deny')
  })
})

// ── MCP ───────────────────────────────────────────────────────────────────────

describe('mcp rules (engine + CC alias forms)', () => {
  it('server-only rule matches all engine tools of the server', () => {
    expect(
      evalRule('deny', ['mcp__github'], call({ engineToolName: 'mcp_github_get_issue' }))!.action,
    ).toBe('deny')
    expect(
      evalRule('deny', ['mcp__github'], call({ engineToolName: 'mcp_gitlab_get_issue' })),
    ).toBeUndefined()
  })

  it('server__tool exact match', () => {
    expect(
      evalRule(
        'deny',
        ['mcp__github__get_issue'],
        call({ engineToolName: 'mcp_github_get_issue' }),
      )!.action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['mcp__github__get_issue'],
        call({ engineToolName: 'mcp_github_list_issues' }),
      ),
    ).toBeUndefined()
  })

  it('server__tool* prefix glob', () => {
    expect(
      evalRule('deny', ['mcp__github__get_*'], call({ engineToolName: 'mcp_github_get_issue' }))!
        .action,
    ).toBe('deny')
  })

  it('server name with special chars is sanitized to match the engine alias', () => {
    expect(
      evalRule('deny', ['mcp__git-hub'], call({ engineToolName: 'mcp_git_hub_get_issue' }))!.action,
    ).toBe('deny')
  })
})

// ── Agent / Skill ─────────────────────────────────────────────────────────────

describe('Skill permissions', () => {
  it('Skill(name) and Skill(name *) prefix', () => {
    expect(
      evalRule(
        'deny',
        ['Skill(deploy)'],
        call({ engineToolName: 'skill', input: { name: 'deploy' } }),
      )!.action,
    ).toBe('deny')
    expect(
      evalRule(
        'deny',
        ['Skill(deploy *)'],
        call({ engineToolName: 'skill', input: { name: 'deploy-staging' } }),
      )!.action,
    ).toBe('deny')
  })
})

// ── describe ─────────────────────────────────────────────────────────────────

describe('describeCcRuleMatch', () => {
  it('names the rule, source scope, and verb', () => {
    const rules = parseCcPermissionRules([block({ scope: 'local', deny: ['Bash(rm:*)'] })])
    const match = evaluateCcRules(rules, call({ engineToolName: 'bash', command: 'rm -rf x' }))!
    const msg = describeCcRuleMatch(match)
    expect(msg).toContain('Bash(rm:*)')
    expect(msg).toContain('local')
    expect(msg).toContain('denies')
  })
})
