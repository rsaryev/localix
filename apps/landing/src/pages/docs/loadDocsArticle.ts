import { lazy } from 'react'

export const preloadDocsArticle = () => import('./DocsArticle')
export const LazyDocsArticle = lazy(() =>
  preloadDocsArticle().then((m) => ({ default: m.DocsArticle })),
)
