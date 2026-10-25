import type { ConfigValue, ItemAction } from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import { ARCHIVE_UNUSED } from './store-idle'

export const UNPIN: ItemAction = {
  id: 'unpin',
  label: 'Unpin',
  help: 'Let it be archived when unused',
}
export const ARCHIVE: ItemAction = {
  id: 'archive',
  label: 'Archive',
  help: 'Take it out of use; restore it any time',
}
export const RESTORE: ItemAction = { id: 'restore', label: 'Restore', help: 'Put it back in use' }

/** What the SKILL.md writer accepts as a name (the skill's folder). */
export const SKILL_NAME = /^[a-z0-9][a-z0-9_-]*$/i

export const textOf = (values: Record<string, ConfigValue>, key: string, fallback = ''): string => {
  const value = values[key]
  return typeof value === 'string' ? value : fallback
}

export function knownShelfAction(action: string): void {
  if (action !== ARCHIVE_UNUSED.id)
    throw new InvalidRequestError('skill_store_action', `Skills have no shelf action "${action}"`)
}
