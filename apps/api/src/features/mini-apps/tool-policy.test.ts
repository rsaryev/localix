import { describe, expect, test } from 'bun:test'
import {
  capMiniAppToolDescription,
  isAcceptableToolName,
  isReservedToolName,
  MINI_APP_TOOL_DESCRIPTION_MAX_CHARS,
  TOOL_NAME_RE,
} from './tool-policy'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'

const builtins = new Set<string>(BUILTIN_TOOL_NAMES)
const aBuiltin = [...builtins][0] // a real reserved name from the canonical set

describe('plugin tool-name policy', () => {
  test('accepts a well-formed, non-reserved name', () => {
    expect(isAcceptableToolName('my_tool')).toBe(true)
    expect(isAcceptableToolName('search2')).toBe(true)
  })

  test('rejects names that collide with a built-in (no shadowing)', () => {
    expect(isReservedToolName(aBuiltin)).toBe(true)
    expect(isAcceptableToolName(aBuiltin)).toBe(false)
    for (const name of ['bash', 'read', 'write']) {
      // these are built-ins; even with a valid shape they must be unacceptable
      expect(builtins.has(name)).toBe(true)
      expect(isAcceptableToolName(name)).toBe(false)
    }
    for (const name of ['Bash', 'LOCALIX_UI', 'Vault']) {
      expect(isAcceptableToolName(name)).toBe(false)
    }
  })

  test('rejects dependency-injected core tools through the same built-in catalog', () => {
    // `vault` is implemented by the secrets feature and injected only when that
    // dependency exists, but its model-visible identity belongs to the canonical
    // built-in catalog so /rpc/tools, settings, profiles, and reservation agree.
    expect(BUILTIN_TOOL_NAMES).toContain('vault')
    expect(isReservedToolName('vault')).toBe(true)
    expect(isAcceptableToolName('vault')).toBe(false)
  })

  test('does not reserve valid names owned by plugins (not core built-ins)', () => {
    // Synthetic plugin names stay absent from BUILTIN_TOOL_NAMES and acceptable to the loader.
    // This guards the former leak where plugin-owned names lived in core's tool catalog.
    for (const name of ['sample_reader', 'sample_writer']) {
      expect(BUILTIN_TOOL_NAMES).not.toContain(name)
      expect(isReservedToolName(name)).toBe(false)
      expect(isAcceptableToolName(name)).toBe(true)
    }
  })

  test('rejects syntactically invalid names', () => {
    expect(isAcceptableToolName('')).toBe(false)
    expect(isAcceptableToolName('_leading')).toBe(false)
    expect(isAcceptableToolName('has space')).toBe(false)
    expect(isAcceptableToolName('has-hyphen')).toBe(false)
    expect(isAcceptableToolName('MixedCase')).toBe(false)
    expect(isAcceptableToolName('a'.repeat(65))).toBe(false) // > 64 chars
  })

  test('rejects the mcp_ namespace (reserved for MCP server tools)', () => {
    // A plugin tool named mcp_* would shadow a real namespaced MCP tool
    // (mcp_<server>_<tool>) in the shared, last-writer-wins tool map.
    expect(isAcceptableToolName('mcp_github_search')).toBe(false)
    expect(isAcceptableToolName('MCP_Github')).toBe(false) // case-insensitive
    expect(isAcceptableToolName('mcp_')).toBe(false)
    // A name that merely CONTAINS mcp_ (not a prefix) is fine.
    expect(isAcceptableToolName('my_mcp_helper')).toBe(true)
  })

  test('TOOL_NAME_RE matches the documented shape', () => {
    expect(TOOL_NAME_RE.test('a')).toBe(true)
    expect(TOOL_NAME_RE.test('a'.repeat(64))).toBe(true)
    expect(TOOL_NAME_RE.test('a'.repeat(65))).toBe(false)
    expect(TOOL_NAME_RE.test('Uppercase')).toBe(false)
  })

  test('a non-reserved name is not flagged reserved', () => {
    expect(isReservedToolName('definitely_not_a_builtin_xyz')).toBe(false)
  })

  test('reserves core-owned names that are not tools', () => {
    // `request_secret` is a HITL request KIND raised by the `vault` tool (and formerly a
    // tool of its own). It is in no tool registry, so nothing else would stop a plugin
    // from claiming it — and a plugin tool wearing that name makes the transcript and the
    // audit trail ambiguous about which surface asked the user for a credential.
    expect(isReservedToolName('request_secret')).toBe(true)
    expect(isAcceptableToolName('request_secret')).toBe(false)
    // The live credential tool is reserved as an ordinary built-in tool.
    expect(isAcceptableToolName('vault')).toBe(false)
  })
})

describe('plugin tool model metadata budget', () => {
  test('keeps ordinary detailed descriptions unchanged', () => {
    const description = 'What it does. When to use it. How to call it. Important caveat.'
    expect(capMiniAppToolDescription(description)).toBe(description)
  })

  test('caps an anomalous description deterministically with an explicit marker', () => {
    const description = 'x'.repeat(MINI_APP_TOOL_DESCRIPTION_MAX_CHARS + 500)
    const capped = capMiniAppToolDescription(description)

    expect(capped).toHaveLength(MINI_APP_TOOL_DESCRIPTION_MAX_CHARS)
    expect(capped).toEndWith('…')
  })
})
