/**
 * THE TOOL-PORT SHAPE, pinned. An optional built-in tool reaches the registry through exactly
 * one key of `OptionalToolPorts`, named after the tool, and is registered by exactly one
 * branch that reads that key. Read from SOURCE so a key that is a typo, a tool that never got
 * a port, or a port that never got a branch each fails here rather than as a tool that is
 * silently absent from every run.
 *
 *   ports ⊆ catalog        a port for a name the catalog does not know is a typo
 *   optional catalog = ports   every optional built-in has its port (extraTools-channel
 *                          tools — plugin/MCP-hosted — are the stated exception)
 *   ports = branches       every port is read by one `optional.<name>` registration
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { stripComments } from '../../lib/source-lint'
import { BUILTIN_TOOL_NAMES } from './tool-names'

const HERE = import.meta.dir
const read = (file: string) => stripComments(readFileSync(join(HERE, file), 'utf8'))

/** Always built (`buildCoreTools`) — no port because there is nothing optional about them. */
const CORE_TOOLS = [
  'ask',
  'bash',
  'read',
  'view_image',
  'search',
  'write',
  'edit',
  'apply_patch',
  'research',
]
/** Arrive through `policy.extraTools` as host/plugin-owned instances, not through a port. */
const EXTRA_TOOLS_CHANNEL = ['mcp_resources', 'vault']

function portKeys(source = read('tool-registry.ts')): string[] {
  const block = /export interface OptionalToolPorts \{([\s\S]*?)\n\}/.exec(source)?.[1]
  if (!block) throw new Error('OptionalToolPorts not found')
  return [...block.matchAll(/^\s*([a-z_]+)\?:/gm)].map((m) => m[1]!)
}

function registrationBranches(
  optionals = read('tool-registry-optionals.ts'),
  registry = read('tool-registry.ts'),
): string[] {
  const names = new Set<string>()
  for (const src of [optionals, registry]) {
    for (const m of src.matchAll(/\boptional\.([a-z_]+)\b/g)) names.add(m[1]!)
  }
  return [...names]
}

describe('tool ports — one key per optional built-in, one branch per key', () => {
  test('every port is a catalogued tool name', () => {
    const catalog = new Set(BUILTIN_TOOL_NAMES)
    expect(portKeys().filter((k) => !catalog.has(k))).toEqual([])
  })

  test('every optional built-in has a port, and nothing else does', () => {
    const optionalCatalog = BUILTIN_TOOL_NAMES.filter(
      (n) => !CORE_TOOLS.includes(n) && !EXTRA_TOOLS_CHANNEL.includes(n),
    ).sort()
    expect([...portKeys()].sort()).toEqual(optionalCatalog)
  })

  test('every port is read by a registration branch, and no branch reads a phantom port', () => {
    const ports = [...portKeys()].sort()
    expect(registrationBranches().sort()).toEqual(ports)
  })

  test('positive control: a planted port without a catalog entry is caught', () => {
    const planted = read('tool-registry.ts').replace(
      'export interface OptionalToolPorts {',
      'export interface OptionalToolPorts {\n  quantum_debugger?: AgentTool',
    )
    expect(portKeys(planted)).toContain('quantum_debugger')
    expect(portKeys(planted).filter((k) => !BUILTIN_TOOL_NAMES.includes(k))).toEqual([
      'quantum_debugger',
    ])
  })
})
