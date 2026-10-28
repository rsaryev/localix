/**
 * The session tools as Claude Code's: `loops` is CronCreate / CronDelete / CronList /
 * ScheduleWakeup, `McpResources` is ListMcpResourcesTool / ReadMcpResourceTool; a presented
 * plan answers as ExitPlanMode's `{plan}` and an MCP tool's result as its content blocks.
 */
import { expect, test } from 'bun:test'

import {
  claudeCodeHookCall,
  claudeCodeToolResponse,
  localToolName,
  toolInputOf,
} from './cc-tool-shapes'

test('a loop is a Claude Code cron job or wakeup, both ways', () => {
  expect(
    claudeCodeHookCall({ name: 'Loops' }, { action: 'add', cron: '*/5 * * * *', prompt: 'Check' }),
  ).toMatchObject({
    tool_name: 'CronCreate',
    tool_input: { cron: '*/5 * * * *', prompt: 'Check', recurring: true },
  })
  expect(claudeCodeHookCall({ name: 'Loops' }, { action: 'remove', id: 'j1' })).toMatchObject({
    tool_name: 'CronDelete',
    tool_input: { id: 'j1' },
  })
  expect(claudeCodeHookCall({ name: 'Loops' }, { action: 'list' }).tool_name).toBe('CronList')
  expect(
    claudeCodeHookCall({ name: 'Loops' }, { action: 'reschedule', id: 'j1', delay_seconds: 90 }),
  ).toMatchObject({ tool_name: 'ScheduleWakeup', tool_input: { delaySeconds: 90 } })
  expect(toolInputOf('Loops', { tool: 'CronCreate', cron: '0 9 * * *', prompt: 'Brief' })).toEqual({
    action: 'add',
    cron: '0 9 * * *',
    prompt: 'Brief',
  })
  expect(toolInputOf('Loops', { tool: 'ScheduleWakeup', delaySeconds: 60, reason: 'r' })).toEqual({
    action: 'reschedule',
    delay_seconds: 60,
  })
  expect(localToolName('CronCreate')).toBe('Loops')
})

test('MCP resources are ListMcpResourcesTool and ReadMcpResourceTool', () => {
  expect(claudeCodeHookCall({ name: 'McpResources' }, { action: 'list' }).tool_name).toBe(
    'ListMcpResourcesTool',
  )
  const read = { action: 'read', server: 'docs', uri: 'file:///a' }
  expect(claudeCodeHookCall({ name: 'McpResources' }, read)).toMatchObject({
    tool_name: 'ReadMcpResourceTool',
    tool_input: { server: 'docs', uri: 'file:///a' },
  })
  expect(
    toolInputOf('McpResources', { tool: 'ReadMcpResourceTool', server: 's', uri: 'u' }),
  ).toEqual({ action: 'read', server: 's', uri: 'u' })
})

test('a presented plan answers as ExitPlanMode; an MCP tool with its content blocks', () => {
  const present = { action: 'present', title: 'Auth', body: '1. Extract' }
  expect(claudeCodeToolResponse({ name: 'Plan' }, { content: 'Presented' }, present)).toEqual({
    plan: '# Auth\n\n1. Extract',
    isAgent: false,
  })
  expect(claudeCodeToolResponse({ name: 'mcp_gh_issue' }, { content: 'Issue #4' }, {})).toEqual([
    { type: 'text', text: 'Issue #4' },
  ])
})
