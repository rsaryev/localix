// Re-export of the real renderer. We deliberately do NOT lazy-load it.
//
// Lazy-loading split react-markdown + KaTeX + sugar-high into a separate chunk,
// which kept the empty home screen lean — but it meant the FIRST markdown render
// showed a raw-text Suspense fallback for a beat and then swapped to parsed
// markdown (different heading/code-block heights), so the message visibly
// re-rendered / "jumped". A static import folds the renderer into the chat
// feature chunk (which is needed the moment any message exists anyway), so there
// is no fallback frame and no swap.
export { default as MarkdownRenderer } from './MarkdownRendererImpl'
export type { MarkdownRendererProps } from './MarkdownRendererImpl'
