import { describe, expect, test } from 'bun:test'

import { AGENT_TASK_NAME_PATTERN } from './agent-task-name'
import {
  AGENT_TASK_ROOT_PATH,
  AGENT_TASK_SEGMENT_FALLBACK,
  AGENT_TASK_SEGMENT_MAX,
  agentTaskPath,
  agentTaskPathHasPrefix,
  agentTaskSegmentOf,
  claimAgentTaskPath,
  deriveAgentTaskSegment,
  isCanonicalAgentTaskPath,
  resolveAgentTaskReference,
} from './agent-task-name'

describe('deriveAgentTaskSegment', () => {
  test('slugifies a human description into the delegated-run path shape', () => {
    expect(deriveAgentTaskSegment('Audit the auth flow')).toBe('audit_the_auth_flow')
    expect(deriveAgentTaskSegment('  Fix LOCALIX-500 (again!)  ')).toBe('fix_localix_500_again')
    expect(deriveAgentTaskSegment('port 5050 → 5051')).toBe('port_5050_5051')
  })

  test('every derived segment satisfies AGENT_TASK_NAME_PATTERN', () => {
    for (const description of [
      'Audit the auth flow',
      '__leading and trailing__',
      '9 lives',
      'a',
      'CamelCase/With/Slashes',
      'x'.repeat(200),
      '—— punctuation ——',
    ]) {
      expect(deriveAgentTaskSegment(description)).toMatch(AGENT_TASK_NAME_PATTERN)
    }
  })

  test('truncates to the pattern ceiling without leaving a separator artifact', () => {
    const filled = deriveAgentTaskSegment(`${'a'.repeat(40)} ${'b'.repeat(20)}`)
    expect(filled).toHaveLength(AGENT_TASK_SEGMENT_MAX)
    expect(filled).toBe(`${'a'.repeat(40)}_${'b'.repeat(7)}`)
    // Here the cut lands exactly ON the `_` the space became: it must not survive as a trailing
    // one, even though that costs a character of the ceiling.
    const onSeparator = deriveAgentTaskSegment(`${'a'.repeat(47)} tail`)
    expect(onSeparator).toBe('a'.repeat(47))
    expect(deriveAgentTaskSegment(`${'a'.repeat(48)} tail`)).toBe('a'.repeat(48))
  })

  test('falls back when nothing usable survives, including the reserved root name', () => {
    expect(deriveAgentTaskSegment('***')).toBe(AGENT_TASK_SEGMENT_FALLBACK)
    expect(deriveAgentTaskSegment('')).toBe(AGENT_TASK_SEGMENT_FALLBACK)
    expect(deriveAgentTaskSegment('   ')).toBe(AGENT_TASK_SEGMENT_FALLBACK)
    // Non-latin text has no slug: it must degrade to a valid name, never to an empty one. The
    // input is built from code points rather than written literally — the repo forbids non-English
    // text in source, and a test for non-latin handling still has to feed it some.
    const nonLatin = String.fromCodePoint(0x30c6, 0x30b9, 0x30c8, 0x0020, 0x4e2d, 0x6587)
    expect(deriveAgentTaskSegment(nonLatin)).toBe(AGENT_TASK_SEGMENT_FALLBACK)
    // `root` would produce a second `/root` inside one path (codex reserves it too).
    expect(deriveAgentTaskSegment('Root')).toBe(AGENT_TASK_SEGMENT_FALLBACK)
  })
})

describe('claimAgentTaskPath — the collision rule', () => {
  test('a free name is taken as-is', () => {
    expect(claimAgentTaskPath('/root/audit', new Set())).toBe('/root/audit')
  })

  test('a taken name gets the first free ordinal, never the existing agent', () => {
    const taken = new Set(['/root/audit'])
    expect(claimAgentTaskPath('/root/audit', taken)).toBe('/root/audit_2')
    taken.add('/root/audit_2')
    expect(claimAgentTaskPath('/root/audit', taken)).toBe('/root/audit_3')
  })

  test('reuses a hole left in the ordinal sequence — the choice is deterministic', () => {
    const taken = new Set(['/root/audit', '/root/audit_3'])
    expect(claimAgentTaskPath('/root/audit', taken)).toBe('/root/audit_2')
    expect(claimAgentTaskPath('/root/audit', taken)).toBe('/root/audit_2')
  })

  test('collision is scoped by the WHOLE path, so equal leaves under different parents coexist', () => {
    const taken = new Set(['/root/a/worker'])
    expect(claimAgentTaskPath('/root/b/worker', taken)).toBe('/root/b/worker')
  })

  test('the ordinal survives the length ceiling; the base is what gets cut', () => {
    const leaf = 'a'.repeat(AGENT_TASK_SEGMENT_MAX)
    const taken = new Set([`/root/${leaf}`])
    const claimed = claimAgentTaskPath(`/root/${leaf}`, taken)
    expect(claimed).toBe(`/root/${'a'.repeat(AGENT_TASK_SEGMENT_MAX - 2)}_2`)
    expect(agentTaskSegmentOf(claimed)).toMatch(AGENT_TASK_NAME_PATTERN)
  })

  test('always terminates on a densely occupied tree, and every name stays valid', () => {
    const taken = new Set(['/root/audit'])
    for (let n = 2; n <= 40; n += 1) taken.add(`/root/audit_${n}`)
    const claimed = claimAgentTaskPath('/root/audit', taken)
    expect(claimed).toBe('/root/audit_41')
    expect(taken.has(claimed)).toBe(false)
  })

  test('never renames the tree root: a duplicate /root is a topology bug, not a name clash', () => {
    expect(claimAgentTaskPath(AGENT_TASK_ROOT_PATH, new Set([AGENT_TASK_ROOT_PATH]))).toBe(
      AGENT_TASK_ROOT_PATH,
    )
  })
})

describe('isCanonicalAgentTaskPath', () => {
  test('accepts the root and any depth of valid segments below it', () => {
    expect(isCanonicalAgentTaskPath('/root')).toBe(true)
    expect(isCanonicalAgentTaskPath('/root/audit')).toBe(true)
    expect(isCanonicalAgentTaskPath('/root/audit/probe_lint/deep_9')).toBe(true)
  })

  test('rejects anything that is not rooted, aligned, and lowercase', () => {
    for (const path of [
      'root/audit',
      '/audit',
      '/root/',
      '/root//audit',
      '/root/Audit',
      '/root/audit-repo',
      '/root/audit repo',
      '/root/root',
      '/root/..',
      '/root/_leading',
      `/root/${'a'.repeat(AGENT_TASK_SEGMENT_MAX + 1)}`,
    ]) {
      expect(isCanonicalAgentTaskPath(path)).toBe(false)
    }
  })
})

describe('resolveAgentTaskReference — canonical vs relative', () => {
  test('a relative name resolves against the CALLER, not the tree root', () => {
    expect(resolveAgentTaskReference('/root/task1', 'task_3')).toEqual({
      ok: true,
      path: '/root/task1/task_3',
    })
    expect(resolveAgentTaskReference('/root', 'task_3')).toEqual({ ok: true, path: '/root/task_3' })
  })

  test('a multi-segment relative name reaches a grandchild', () => {
    expect(resolveAgentTaskReference('/root/task1', 'worker/probe')).toEqual({
      ok: true,
      path: '/root/task1/worker/probe',
    })
  })

  test('a canonical name is accepted verbatim, from any caller', () => {
    expect(resolveAgentTaskReference('/root/task2', '/root/task1/task_3')).toEqual({
      ok: true,
      path: '/root/task1/task_3',
    })
    expect(resolveAgentTaskReference('/root/task2', AGENT_TASK_ROOT_PATH)).toEqual({
      ok: true,
      path: AGENT_TASK_ROOT_PATH,
    })
  })

  test('a relative name can NEVER cross into a sibling branch', () => {
    // The property codex spells out: `/root/task2` may only reach `/root/task1/task_3` by its
    // canonical name. Relatively, `task_3` means task2's OWN child — a different agent, or none.
    expect(resolveAgentTaskReference('/root/task2', 'task_3')).toEqual({
      ok: true,
      path: '/root/task2/task_3',
    })
  })

  test('no upward traversal exists', () => {
    for (const reference of ['..', '../sibling', './self', '/root/../task2']) {
      expect(resolveAgentTaskReference('/root/task1', reference).ok).toBe(false)
    }
  })

  test('trims incidental whitespace but rejects everything else that is not a name', () => {
    expect(resolveAgentTaskReference('/root', '  task_3  ')).toEqual({
      ok: true,
      path: '/root/task_3',
    })
    for (const reference of ['', '   ', 'Task_3', 'task-3', 'task 3', 'root', 'task_3/', '/nope']) {
      const resolved = resolveAgentTaskReference('/root', reference)
      expect(resolved.ok).toBe(false)
      if (!resolved.ok) expect(resolved.reason).toBeTruthy()
    }
  })

  test('a caller with no canonical name of its own cannot resolve a relative reference', () => {
    // An unnamed session (one predating the column) must fail closed rather than silently
    // resolving as if it were the tree root — that would address a stranger's child.
    expect(resolveAgentTaskReference('', 'task_3').ok).toBe(false)
    expect(resolveAgentTaskReference('LOCALIX-500', 'task_3').ok).toBe(false)
    // A canonical reference from such a caller is still unambiguous, so it resolves.
    expect(resolveAgentTaskReference('', '/root/task_3')).toEqual({
      ok: true,
      path: '/root/task_3',
    })
  })
})

describe('agentTaskPathHasPrefix — the listing filter', () => {
  test('the root prefix matches the whole tree', () => {
    expect(agentTaskPathHasPrefix('/root', AGENT_TASK_ROOT_PATH)).toBe(true)
    expect(agentTaskPathHasPrefix('/root/a/b', AGENT_TASK_ROOT_PATH)).toBe(true)
  })

  test('a branch prefix matches itself and its descendants', () => {
    expect(agentTaskPathHasPrefix('/root/audit', '/root/audit')).toBe(true)
    expect(agentTaskPathHasPrefix('/root/audit/probe', '/root/audit')).toBe(true)
  })

  test('is SEGMENT-ALIGNED: an underscore-extended sibling is not a descendant', () => {
    // The exact hazard a `LIKE 'prefix%'` (or a bare startsWith) would introduce, since `_` is
    // both an ordinary character in these names and LIKE's single-character wildcard.
    expect(agentTaskPathHasPrefix('/root/audit_repo', '/root/audit')).toBe(false)
    expect(agentTaskPathHasPrefix('/root/auditory', '/root/audit')).toBe(false)
    expect(agentTaskPathHasPrefix('/root/other/audit', '/root/audit')).toBe(false)
  })
})

describe('path helpers', () => {
  test('agentTaskPath and agentTaskSegmentOf are inverses', () => {
    const path = agentTaskPath('/root/audit', 'probe_lint')
    expect(path).toBe('/root/audit/probe_lint')
    expect(agentTaskSegmentOf(path)).toBe('probe_lint')
    expect(agentTaskSegmentOf(AGENT_TASK_ROOT_PATH)).toBe('root')
  })
})
