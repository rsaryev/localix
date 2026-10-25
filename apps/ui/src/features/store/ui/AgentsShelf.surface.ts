import { Bot } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { STORE_KIND } from '@/shared/lib/openStore'

/** Agents are Claude Code agent files, and the Store is where files and plugins of every kind live. */
export default defineUiLocation({
  id: 'agents.open',
  uri: 'localix://ui/work-item/store/agents',
  title: 'Agents',
  description: 'The Store on its Agents shelf: create, edit, move and remove agents',
  agent: { description: 'Open the Store on its Agents shelf, where the person manages agents' },
  keywords: ['agents', 'subagents', 'delegation', 'persona', 'create agent', 'new agent'],
  group: 'Application',
  Icon: Bot,
  effect: 'read',
  surface: 'work-item',
  exposure: { search: true, palette: true },
  resolve: () => ({
    kind: 'work-item',
    workKind: STORE_KIND,
    id: STORE_KIND,
    title: 'Store',
    payload: { shelf: 'package:agent' },
  }),
})
