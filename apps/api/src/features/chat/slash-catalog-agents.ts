import type { SlashArgSpec } from './slash-args'

export const AGENTS_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an agent action…',
    options: [
      { value: 'list', label: 'list', description: 'List this registry’s agents' },
      { value: 'help', label: 'help', description: 'Where agents are managed' },
    ],
  },
]
