import { useEffect } from 'react'
import type { DocPage } from '@/generated/docs'
import { SITE_ORIGIN } from '@/lib/site'

const HOME_TITLE = 'Localix — One workspace for you and a team of agents'
const HOME_DESCRIPTION =
  'Localix is an open source Agentic Development Environment: one workspace where you and a team of agents share the editor, terminals, preview, and databases.'
const HOME_URL = `${SITE_ORIGIN}/`
const HOME_STRUCTURED_DATA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Localix',
  applicationCategory: 'DeveloperApplication',
  url: HOME_URL,
  description: HOME_DESCRIPTION,
  image: `${HOME_URL}og.png`,
  author: { '@type': 'Organization', name: 'Localix', url: HOME_URL },
})

/**
 * The tags this hook owns. `index.html` ships them for the home page, so every
 * one is edited in place and restored on cleanup rather than created — a docs
 * page that unmounts must leave the document exactly as it found it, or a
 * client-side return to `/` keeps the last article's title and canonical URL.
 */
function metaTargets() {
  const meta = <T extends Element>(selector: string) => document.querySelector<T>(selector)
  return {
    canonical: meta<HTMLLinkElement>('link[rel="canonical"]'),
    description: meta<HTMLMetaElement>('meta[name="description"]'),
    ogTitle: meta<HTMLMetaElement>('meta[property="og:title"]'),
    ogType: meta<HTMLMetaElement>('meta[property="og:type"]'),
    ogDescription: meta<HTMLMetaElement>('meta[property="og:description"]'),
    ogUrl: meta<HTMLMetaElement>('meta[property="og:url"]'),
    twitterTitle: meta<HTMLMetaElement>('meta[name="twitter:title"]'),
    twitterDescription: meta<HTMLMetaElement>('meta[name="twitter:description"]'),
    structuredData: meta<HTMLScriptElement>('script[type="application/ld+json"]'),
  }
}

function apply(
  tags: ReturnType<typeof metaTargets>,
  values: {
    title: string
    description: string
    url: string
    ogType: 'article' | 'website'
    structuredData: string
  },
) {
  document.title = values.title
  if (tags.canonical) tags.canonical.href = values.url
  if (tags.description) tags.description.content = values.description
  if (tags.ogTitle) tags.ogTitle.content = values.title
  if (tags.ogType) tags.ogType.content = values.ogType
  if (tags.ogDescription) tags.ogDescription.content = values.description
  if (tags.ogUrl) tags.ogUrl.content = values.url
  if (tags.twitterTitle) tags.twitterTitle.content = values.title
  if (tags.twitterDescription) tags.twitterDescription.content = values.description
  if (tags.structuredData) tags.structuredData.textContent = values.structuredData
}

/** Reflects the open page in browser/search metadata; restores the home tags on leaving docs. */
export function useDocMetadata(active: DocPage | undefined) {
  useEffect(() => {
    if (!active) return
    const tags = metaTargets()
    const title = `${active.title} · Localix Docs`
    const url = `${SITE_ORIGIN}/docs/${encodeURIComponent(active.slug)}`

    apply(tags, {
      title,
      description: active.summary,
      url,
      ogType: 'article',
      structuredData: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description: active.summary,
        url,
        isPartOf: { '@type': 'WebSite', name: 'Localix', url: HOME_URL },
      }),
    })

    return () => {
      apply(tags, {
        title: HOME_TITLE,
        description: HOME_DESCRIPTION,
        url: HOME_URL,
        ogType: 'website',
        structuredData: HOME_STRUCTURED_DATA,
      })
    }
  }, [active])
}
