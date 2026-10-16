// The app's link grammar for a surface that takes links as text: a pasted `@session:…` or
// `localix://…` becomes the binding a drag of that thing carries (`contextLinks.ts` says why).
export { linksInText } from '@/features/chat/model/contextLinks'
export type { TextLinks } from '@/features/chat/model/contextLinks'
