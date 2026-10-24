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
import { delegatePermissionResources } from '../../../agent-core/tools/delegate'
import { skillPermissionResources } from '../../../agent-core/tools/skill'
import { researchPermissionResources } from '../../../agent-core/tools/web/research-resources'
import { skillPermissionRules } from './permission-gate-build'

const root = '/work/app'
/** The authored list asks about everything; only a grant can answer a call. */
const ASK: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]
const TOOLS = {
  research: { permissionResources: researchPermissionResources },
  delegate: { permissionResources: delegatePermissionResources },
  skill: { permissionResources: skillPermissionResources },
}

function granted(spec: string, toolName: string, input: Record<string, unknown>): boolean {
  const facts = extractCallFacts(toolName, input, root, TOOLS[toolName as keyof typeof TOOLS])
  const grants = skillPermissionRules([spec], root)
  return evaluate(ASK, { name: toolName, effect: 'read' }, facts, grants).action === 'allow'
}

describe('path rules', () => {
  test('a relative pattern anchors at the working directory', () => {
    expect(granted('Read(src/**)', 'read', { path: 'src/a/b.ts' })).toBe(true)
    expect(granted('Read(src/**)', 'read', { path: 'lib/src/b.ts' })).toBe(false)
    expect(granted('Read(./docs/*.md)', 'read', { path: 'docs/a.md' })).toBe(true)
  })

  test('a bare file name matches at any depth, as gitignore does', () => {
    expect(granted('Read(.env.example)', 'read', { path: 'pkg/.env.example' })).toBe(true)
    expect(granted('Read(*.md)', 'read', { path: 'deep/er/a.md' })).toBe(true)
    expect(granted('Read(*.md)', 'read', { path: 'a.ts' })).toBe(false)
  })

  test('`//` is the filesystem root, `~/` home, `/` the project', () => {
    expect(granted('Read(//tmp/scratch/**)', 'read', { path: '/tmp/scratch/a' })).toBe(true)
    expect(granted('Read(~/notes/**)', 'read', { path: `${homedir()}/notes/a.md` })).toBe(true)
    expect(
      granted('Edit(/src/**)', 'edit', { path: 'src/x.ts', old_string: 'a', new_string: 'b' }),
    ).toBe(true)
    expect(granted('Read(/src/**)', 'read', { path: '/src/x.ts' })).toBe(false)
  })

  test('Edit covers write, Read covers search; Write and Glob path rules match nothing', () => {
    expect(granted('Edit(docs/**)', 'write', { path: 'docs/n.md', content: 'x' })).toBe(true)
    expect(granted('Read(src/**)', 'search', { query: 'x', path: 'src' })).toBe(true)
    expect(granted('Write(docs/**)', 'write', { path: 'docs/n.md', content: 'x' })).toBe(false)
    expect(granted('Edit', 'write', { path: 'anywhere.md', content: 'x' })).toBe(true)
  })

  test('braces expand', () => {
    expect(granted('Read(src/*.{ts,tsx})', 'read', { path: 'src/a.tsx' })).toBe(true)
  })
})

describe('named resources', () => {
  test('WebFetch(domain:…) matches the host, case-insensitive, `*.` only subdomains', () => {
    const fetch = (url: string) => ({ question: 'q', urls: [url] })
    expect(
      granted('WebFetch(domain:Example.com)', 'research', fetch('https://example.com/a')),
    ).toBe(true)
    expect(
      granted('WebFetch(domain:*.example.com)', 'research', fetch('https://a.b.example.com')),
    ).toBe(true)
    expect(
      granted('WebFetch(domain:*.example.com)', 'research', fetch('https://example.com')),
    ).toBe(false)
    expect(
      granted('WebFetch(domain:example.*)', 'research', fetch('https://example.evil.com')),
    ).toBe(false)
    expect(granted('WebFetch(domain:example.com)', 'research', { question: 'web search' })).toBe(
      false,
    )
  })

  test('Agent(<type>) names the agent; Skill(<name>) the skill', () => {
    expect(granted('Agent(Explore)', 'delegate', { task: 't', agent: 'Explore' })).toBe(true)
    expect(granted('Agent(Explore)', 'delegate', { task: 't', agent: 'Plan' })).toBe(false)
    expect(granted('Skill(deploy)', 'skill', { action: 'get', name: 'deploy' })).toBe(true)
    expect(granted('Skill(deploy)', 'skill', { action: 'get', name: 'other' })).toBe(false)
  })

  test('a bare mcp__<server> names every tool of that server', () => {
    const rules = skillPermissionRules(['mcp__github'], root)
    expect(rules).toEqual([{ action: 'allow', permission: 'mcp_github_*', pattern: '*' }])
  })
})
