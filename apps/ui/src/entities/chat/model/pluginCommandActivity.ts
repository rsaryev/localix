import type { CommandActivity } from '@/shared/api/contracts'

const ACTION_LABELS: Record<CommandActivity['action'], string> = {
  install: 'Installing',
  update: 'Updating',
  remove: 'Removing',
  enable: 'Enabling',
  disable: 'Disabling',
  create: 'Creating',
}

/**
 * Recognize lifecycle commands that run synchronously on the backend so the
 * optimistic transcript row can describe the actual work instead of showing a
 * generic assistant skeleton.
 */
export function pluginCommandActivity(prompt: string): CommandActivity | null {
  const match = prompt
    .trim()
    .match(/^\/plugin\s+(install|update|remove|enable|disable|create)\b\s+(.+)$/is)
  if (!match) return null

  const action = match[1]!.toLowerCase() as CommandActivity['action']
  const argument = match[2]!.trim()
  if (!argument) return null
  // `create` takes a description, and the agent names the plugin: no word of it is the subject.
  const subject = action === 'create' ? undefined : argument

  return {
    kind: 'plugin',
    action,
    state: 'running',
    label: `${ACTION_LABELS[action]} plugin`,
    ...(subject ? { subject } : {}),
  }
}
