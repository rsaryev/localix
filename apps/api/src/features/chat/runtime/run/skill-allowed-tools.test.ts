/**
 * A skill's `allowed-tools`, written in Claude Code's permission-rule syntax, pre-approves the
 * calls Claude Code would (permissions.md, "Tool-specific permission rules"): path rules anchor
 * at the working directory (`src/**`), the settings source (`/src/**`), the filesystem root
 * (`//tmp/**`) or home (`~/x`); `Edit` covers every editing tool and `Read` the search tool;
 * `WebFetch(domain:…)` names hosts; a bare `mcp__<server>` names every tool of that server;
 * `Agent(<type>)` and `Skill(<name>)` name the agent and the skill.
 */
import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'

import {
  evaluate,
  extractCallFacts,
  type PermissionRule,
} from '../../../agent-core/permission-engine'
import { agentPermissionResources } from '../../../agent-core/tools/agent/agent-tool'
import { skillPermissionResources } from '../../../agent-core/tools/skill'
import { researchPermissionResources } from '../../../agent-core/tools/web/research-resources'
import { skillPermissionRules } from './permission-gate-build'

const root = '/work/app'
/** The authored list asks about everything; only a grant can answer a call. */
const ASK: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]
const TOOLS = {
  Research: { permissionResources: researchPermissionResources },
  Agent: { permissionResources: agentPermissionResources },
  Skill: { permissionResources: skillPermissionResources },
}

function granted(spec: string, toolName: string, input: Record<string, unknown>): boolean {
  const facts = extractCallFacts(toolName, input, root, TOOLS[toolName as keyof typeof TOOLS])
  const grants = skillPermissionRules([spec], root)
  return evaluate(ASK, { name: toolName, effect: 'read' }, facts, grants).action === 'allow'
}

describe('path rules', () => {
  test('a relative pattern anchors at the working directory', () => {
    expect(granted('Read(src/**)', 'Read', { path: 'src/a/b.ts' })).toBe(true)
    expect(granted('Read(src/**)', 'Read', { path: 'lib/src/b.ts' })).toBe(false)
    expect(granted('Read(./docs/*.md)', 'Read', { path: 'docs/a.md' })).toBe(true)
  })

  test('a bare file name matches at any depth, as gitignore does', () => {
    expect(granted('Read(.env.example)', 'Read', { path: 'pkg/.env.example' })).toBe(true)
    expect(granted('Read(*.md)', 'Read', { path: 'deep/er/a.md' })).toBe(true)
    expect(granted('Read(*.md)', 'Read', { path: 'a.ts' })).toBe(false)
  })

  test('`//` is the filesystem root, `~/` home, `/` the project', () => {
    expect(granted('Read(//tmp/scratch/**)', 'Read', { path: '/tmp/scratch/a' })).toBe(true)
    expect(granted('Read(~/notes/**)', 'Read', { path: `${homedir()}/notes/a.md` })).toBe(true)
    expect(
      granted('Edit(/src/**)', 'Edit', { path: 'src/x.ts', old_string: 'a', new_string: 'b' }),
    ).toBe(true)
    expect(granted('Read(/src/**)', 'Read', { path: '/src/x.ts' })).toBe(false)
  })

  test('Edit covers write, Read covers search; Write and Glob path rules match nothing', () => {
    expect(granted('Edit(docs/**)', 'Write', { path: 'docs/n.md', content: 'x' })).toBe(true)
    expect(granted('Read(src/**)', 'Search', { query: 'x', path: 'src' })).toBe(true)
    expect(granted('Write(docs/**)', 'Write', { path: 'docs/n.md', content: 'x' })).toBe(false)
    expect(granted('Edit', 'Write', { path: 'anywhere.md', content: 'x' })).toBe(true)
  })

  test('braces expand', () => {
    expect(granted('Read(src/*.{ts,tsx})', 'Read', { path: 'src/a.tsx' })).toBe(true)
  })
})

describe('named resources', () => {
  test('WebFetch(domain:…) matches the host, case-insensitive, `*.` only subdomains', () => {
    const fetch = (url: string) => ({ question: 'q', urls: [url] })
    expect(
      granted('WebFetch(domain:Example.com)', 'Research', fetch('https://example.com/a')),
    ).toBe(true)
    expect(
      granted('WebFetch(domain:*.example.com)', 'Research', fetch('https://a.b.example.com')),
    ).toBe(true)
    expect(
      granted('WebFetch(domain:*.example.com)', 'Research', fetch('https://example.com')),
    ).toBe(false)
    expect(
      granted('WebFetch(domain:example.*)', 'Research', fetch('https://example.evil.com')),
    ).toBe(false)
    expect(granted('WebFetch(domain:example.com)', 'Research', { question: 'web search' })).toBe(
      false,
    )
  })

  test('Agent(<type>) names the agent; Skill(<name>) the skill', () => {
    expect(granted('Agent(Explore)', 'Agent', { prompt: 't', subagent_type: 'Explore' })).toBe(true)
    expect(granted('Agent(Explore)', 'Agent', { prompt: 't', subagent_type: 'Plan' })).toBe(false)
    expect(granted('Skill(deploy)', 'Skill', { action: 'get', name: 'deploy' })).toBe(true)
    expect(granted('Skill(deploy)', 'Skill', { action: 'get', name: 'other' })).toBe(false)
  })

  test('a bare mcp__<server> names every tool of that server', () => {
    const rules = skillPermissionRules(['mcp__github'], root)
    expect(rules).toEqual([{ action: 'allow', permission: 'mcp_github_*', pattern: '*' }])
  })
})
