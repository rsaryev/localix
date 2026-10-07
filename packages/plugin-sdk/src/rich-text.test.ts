import { expect, test } from 'bun:test'
import {
  richTextDocument,
  richTextSchema,
  richTextToMarkdown,
  richTextToText,
  type RichTextDocument,
} from './rich-text'

export const example: RichTextDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'C++', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: 'work',
          marks: [
            { type: 'italic' },
            { type: 'link', attrs: { href: 'https://example.com/a%20b' } },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test('rich structure round trips with stable text and Markdown formatting', () => {
  expect(richTextSchema.parse(example)).toEqual(example)
  expect(richTextToText(example)).toBe('C++\nwork\n\n3. Parent\n  • Child')
  expect(richTextToMarkdown(example)).toBe(
    '**C\\+\\+**  \n[_work_](<https://example.com/a%20b>)\n\n3. Parent\n   - Child',
  )
  expect(richTextToText(richTextDocument('line\nline'))).toBe('line\nline')
  expect(richTextSchema.safeParse(richTextDocument('')).success).toBe(true)
})

test('rejects unsupported nodes, unsafe URLs and repeated marks', () => {
  const rich = (node: unknown) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [node] }],
  })
  expect(
    richTextSchema.safeParse({ type: 'doc', content: [{ type: 'heading', content: [] }] }).success,
  ).toBe(false)
  for (const href of ['javascript:alert(1)', 'data:text/html,evil', '/relative', 'https://'])
    expect(
      richTextSchema.safeParse(
        rich({ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href } }] }),
      ).success,
    ).toBe(false)
  expect(
    richTextSchema.safeParse(
      rich({ type: 'text', text: 'bold', marks: [{ type: 'bold' }, { type: 'bold' }] }),
    ).success,
  ).toBe(false)
})

test('bounds recursive documents before parsing without throwing on cycles', () => {
  const cyclic: { type: string; content: unknown[] } = { type: 'doc', content: [] }
  cyclic.content.push(cyclic)
  expect(richTextSchema.safeParse(cyclic).success).toBe(false)
  expect(
    richTextSchema.safeParse({
      type: 'doc',
      content: Array.from({ length: 1_001 }, () => ({ type: 'paragraph' })),
    }).success,
  ).toBe(false)
})
