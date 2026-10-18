import { afterEach, describe, expect, test } from 'bun:test'
import { useComments } from '@localixai/plugin-sdk/ui/comments'
import {
  forgetReviewComments,
  reviewCommentBinding,
  reviewCommentToken,
} from './reviewCommentBinding'

afterEach(() => {
  useComments.setState({ comments: [] })
})

describe('reviewCommentBinding', () => {
  test('carries the comment id as its token, so two notes on one element stay apart', () => {
    const first = reviewCommentBinding({ token: 'c1', label: 'Preview: Title', content: 'a' })
    const second = reviewCommentBinding({ token: 'c2', label: 'Preview: Title', content: 'b' })

    expect(first.target.token).toBe('@snippet:c1')
    expect(second.target.token).toBe('@snippet:c2')
    expect(reviewCommentToken('c1')).toBe(first.target.token)
  })

  test('nests its evidence, so the note and its screenshot are budgeted as one thing', () => {
    const binding = reviewCommentBinding({
      token: 'c1',
      label: 'Preview: Title',
      content: 'a',
      assets: [{ kind: 'image', mediaType: 'image/jpeg', data: 'YWJj', name: 'pick.jpg', size: 3 }],
    })
    expect(binding.assets).toHaveLength(1)
  })
})

/**
 * The other half of the cycle: a comment exists to be delivered, and once it has ridden out with
 * a message the mark it left is describing feedback already given. Leaving it invited the same
 * note twice and left a reviewed page looking permanently un-actioned.
 */
describe('forgetReviewComments', () => {
  test('drops exactly the comments whose tokens were sent', () => {
    const store = useComments.getState()
    const sent = store.add('preview:s1', { kind: 'element', targetId: 'a', label: 'A' }, 'one')
    const kept = store.add('preview:s1', { kind: 'element', targetId: 'b', label: 'B' }, 'two')

    forgetReviewComments([reviewCommentToken(sent)])

    expect(useComments.getState().comments.map((c) => c.id)).toEqual([kept])
  })

  test('ignores tokens that are not review comments', () => {
    const store = useComments.getState()
    store.add('preview:s1', { kind: 'element', targetId: 'a', label: 'A' }, 'one')

    // A file link and a snippet that no comment owns both ride the same submitted-keys list.
    forgetReviewComments(['@file:src/a.ts', '@snippet:some-other-thing'])

    expect(useComments.getState().comments).toHaveLength(1)
  })
})
