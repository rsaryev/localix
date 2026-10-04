import type { Comment } from '@localixai/plugin-sdk/ui/comments'

export function commentsText(title: string, comments: Comment[]): string {
  return [
    `Review these notes for "${title}":`,
    ...comments.map(
      (comment) => `\n> ${comment.anchor.context ?? comment.anchor.label}\n\n${comment.body}`,
    ),
  ].join('\n')
}
