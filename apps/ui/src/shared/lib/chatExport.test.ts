import { describe, expect, test } from 'bun:test'
import { sessionToMarkdown, exportFileName } from './chatExport'
import type { Message } from '@/shared/api/contracts'

const msg = (m: Partial<Message>): Message => ({ id: 'x', role: 'user', ...m }) as Message

describe('sessionToMarkdown', () => {
  test('renders a title header and one section per conversational turn', () => {
    const md = sessionToMarkdown({
      title: 'My chat',
      messages: [
        msg({ role: 'user', content: 'hi' }),
        msg({ role: 'assistant', content: 'hello' }),
      ],
    })
    expect(md).toBe('# My chat\n\n## You\n\nhi\n\n## Assistant\n\nhello\n')
  })

  test('skips system notices, internal + ui-only rows, and empty-text turns', () => {
    const md = sessionToMarkdown({
      title: 't',
      messages: [
        msg({ role: 'system', content: 'notice' }),
        msg({ role: 'assistant', content: '', items: [] }), // tools-only turn → no text
        msg({ role: 'user', content: 'real', isInternal: false }),
        msg({ role: 'user', content: 'hidden', isInternal: true }),
        msg({ role: 'user', content: 'divider', uiOnly: true }),
      ],
    })
    expect(md).toBe('# t\n\n## You\n\nreal\n')
  })

  test('falls back to a default title when none is set', () => {
    expect(sessionToMarkdown({ title: '', messages: [] })).toBe('# Conversation\n')
    expect(sessionToMarkdown({ title: null, messages: [] })).toBe('# Conversation\n')
  })
})

describe('sessionToMarkdown — redacted', () => {
  const opts = { redacted: true }

  test('replaces tool-backed items with name+status placeholders, keeps prose in order', () => {
    const md = sessionToMarkdown(
      {
        title: 't',
        messages: [
          msg({ role: 'user', content: 'run it' }),
          msg({
            role: 'assistant',
            content: 'Sure.\n\nDone.',
            items: [
              { type: 'text', text: 'Sure.' },
              {
                type: 'command',
                name: 'bash',
                status: 'completed',
                command: 'cat /etc/passwd',
                output: 'SECRET',
              },
              {
                type: 'tool_call',
                name: 'read',
                status: 'failed',
                input: { path: '/private' },
                resultText: 'SECRET',
              },
              { type: 'text', text: 'Done.' },
            ] as Message['items'],
          }),
        ],
      },
      opts,
    )
    expect(md).toBe(
      '# t\n\n## You\n\nrun it\n\n## Assistant\n\nSure.\n\n' +
        '> `[tool: bash — completed · redacted]`\n\n' +
        '> `[tool: read — failed · redacted]`\n\nDone.\n',
    )
    expect(md).not.toContain('SECRET')
    expect(md).not.toContain('/etc/passwd')
  })

  test('includes tools-only turns as a placeholder timeline (plain export skips them)', () => {
    const messages = [
      msg({
        role: 'assistant',
        content: '',
        items: [
          { type: 'file_change', name: 'edit', status: 'completed', changes: [] },
        ] as unknown as Message['items'],
      }),
    ]
    expect(sessionToMarkdown({ title: 't', messages })).toBe('# t\n')
    expect(sessionToMarkdown({ title: 't', messages }, opts)).toBe(
      '# t\n\n## Assistant\n\n> `[tool: edit — completed · redacted]`\n',
    )
  })

  test('redacts attachments and @-ref context expansions, keeping only the kind', () => {
    const md = sessionToMarkdown(
      {
        title: 't',
        messages: [
          msg({
            role: 'user',
            content: 'look at this',
            bindings: [
              { kind: 'image', mediaType: 'image/png', name: 'secret-diagram.png', size: 10 },
              {
                kind: 'context',
                id: 'ctx-1',
                source: 'mention',
                target: { kind: 'file', token: '@file:config.ts', label: 'config.ts' },
                resolution: {
                  status: 'resolved',
                  contributions: [
                    {
                      id: 'c-1',
                      providerId: 'test',
                      providerVersion: '1',
                      scope: 'project',
                      kind: 'file',
                      content: 'API_KEY=xyz',
                      sensitivity: 'project',
                    },
                  ],
                },
              },
            ] as Message['bindings'],
          }),
        ],
      },
      opts,
    )
    expect(md).toBe(
      '# t\n\n## You\n\n> `[attachment: image — redacted]`\n\n> `[context: redacted]`\n\nlook at this\n',
    )
    expect(md).not.toContain('secret-diagram')
    expect(md).not.toContain('API_KEY')
  })

  test('omits reasoning/plan items and keeps skip rules for internal/system rows', () => {
    const md = sessionToMarkdown(
      {
        title: 't',
        messages: [
          msg({ role: 'system', content: 'notice' }),
          msg({ role: 'user', content: 'hidden', isInternal: true }),
          msg({
            role: 'assistant',
            content: 'visible',
            items: [
              { type: 'reasoning', text: 'private chain of thought' },
              { type: 'text', text: 'visible' },
            ] as Message['items'],
          }),
        ],
      },
      opts,
    )
    expect(md).toBe('# t\n\n## Assistant\n\nvisible\n')
  })

  test('keeps code blocks inside prose (authored explanation, not payload)', () => {
    const md = sessionToMarkdown(
      {
        title: 't',
        messages: [msg({ role: 'assistant', content: 'Use:\n\n```ts\nconst a = 1;\n```' })],
      },
      opts,
    )
    expect(md).toContain('```ts\nconst a = 1;\n```')
  })
})

describe('exportFileName', () => {
  test('slugifies the title into a .md filename', () => {
    expect(exportFileName('My Cool Chat!')).toBe('my-cool-chat.md')
    expect(exportFileName('  Trim — Me  ')).toBe('trim-me.md')
  })
  test('appends an optional suffix before the extension', () => {
    expect(exportFileName('My Chat', 'redacted')).toBe('my-chat-redacted.md')
    expect(exportFileName('', 'redacted')).toBe('conversation-redacted.md')
  })
  test('preserves Unicode letters (Latin Extended / CJK) instead of dropping them', () => {
    expect(exportFileName('Café chat!')).toBe('café-chat.md')
    expect(exportFileName('数据分析')).toBe('数据分析.md')
  })
  test('falls back when the title is empty / unusable', () => {
    expect(exportFileName('')).toBe('conversation.md')
    expect(exportFileName('!!!')).toBe('conversation.md')
    expect(exportFileName(null)).toBe('conversation.md')
  })
})
