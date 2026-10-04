/** Fixed vocabulary shared by the human reaction picker and message storage. */
export const MESSAGE_REACTIONS = {
  '👍': 'agreed, nothing to add',
  '👀': 'read it, taking a look',
  '✅': 'done, or confirmed working',
  '❌': 'wrong, or does not work',
  '🤔': 'unclear, or I have doubts',
  '🎉': 'good result worth marking',
} as const

export type MessageReaction = keyof typeof MESSAGE_REACTIONS
