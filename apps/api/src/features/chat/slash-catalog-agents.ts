import type { SlashArgSpec } from './slash-args'

export const AGENTS_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an agent action…',
    options: [
      { value: 'list', label: 'list', description: 'List this registry’s agents' },
      { value: 'members', label: 'members', description: 'List this chat’s participants' },
      {
        value: 'create',
        label: 'create',
        description: 'Describe the agent in your own words, or open the form',
      },
      { value: 'show', label: 'show', description: 'Inspect an agent’s definition' },
      { value: 'edit', label: 'edit', description: 'Edit an agent’s definition' },
      { value: 'copy', label: 'copy', description: 'Copy definition, policy and enabled choice' },
      { value: 'enable', label: 'enable', description: 'Enable new runs' },
      {
        value: 'disable',
        label: 'disable',
        description: 'Disable new runs without stopping existing work',
      },
      {
        value: 'permissions',
        label: 'permissions',
        description: 'Open the user’s permission editor',
      },
      { value: 'add', label: 'add', description: 'Invite into this chat without starting work' },
      {
        value: 'remove',
        label: 'remove',
        description: 'Remove from this chat, keeping the definition',
      },
      {
        value: 'delete',
        label: 'delete',
        description: 'Preview deletion of an unused local agent',
      },
      { value: 'help', label: 'help', description: 'Show usage and examples' },
    ],
  },
  {
    name: 'agent',
    type: 'choice',
    dynamic: true,
    when: {
      arg: 'action',
      equals: [
        'show',
        'edit',
        'copy',
        'enable',
        'disable',
        'permissions',
        'add',
        'remove',
        'delete',
      ],
    },
    placeholder: 'Pick an agent…',
  },
  {
    name: 'new-handle',
    type: 'choice',
    dynamic: true,
    when: { arg: 'action', equals: 'copy' },
    placeholder: 'New handle for the copy…',
  },
  {
    name: 'options',
    type: 'flags',
    when: { arg: 'action', equals: ['create', 'edit', 'delete'] },
    // One word is a handle for the form; a request in your own words has an agent draft it.
    lead: {
      name: 'request',
      placeholder: 'Describe the agent, give it a handle, or type -- for options…',
      when: { arg: 'action', equals: 'create' },
    },
    placeholder: 'Optional flag — Tab to select, Enter to run…',
    flags: [
      {
        name: 'handle',
        flag: '--handle',
        description: 'Rename this agent',
        when: { arg: 'action', equals: 'edit' },
        value: { type: 'text', placeholder: 'New handle…' },
      },
      {
        name: 'description',
        flag: '--description',
        description: 'One-line specialization',
        when: { arg: 'action', equals: ['create', 'edit'] },
        value: { type: 'text', placeholder: 'One-line description…' },
      },
      {
        name: 'instructions',
        flag: '--instructions',
        description: 'Reusable standing instructions',
        when: { arg: 'action', equals: ['create', 'edit'] },
        value: { type: 'text', placeholder: 'Standing instructions…' },
      },
      {
        name: 'priority',
        flag: '--priority',
        description: 'Hierarchy priority from −2 to 2',
        when: { arg: 'action', equals: ['create', 'edit'] },
        value: {
          type: 'choice',
          placeholder: 'Hierarchy priority −2…2…',
          options: [-2, -1, 0, 1, 2].map((value) => ({
            value: String(value),
            label: String(value),
            description:
              value < 0
                ? 'Supporting role'
                : value === 0
                  ? 'Regular specialist'
                  : 'Coordination role',
          })),
        },
      },
      {
        name: 'confirm',
        flag: '--confirm',
        description: 'Confirm deletion of this identity',
        when: { arg: 'action', equals: 'delete' },
      },
    ],
  },
]
