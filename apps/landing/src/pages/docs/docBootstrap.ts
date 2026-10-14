export interface DocHeading {
  depth: 2 | 3
  text: string
  id: string
}

export interface DocBootstrap {
  slug: string
  content: string
  headings: DocHeading[]
  html: string
}

/** Capture the verified build's article before React mounts; never accept a different route. */
export function readDocBootstrap(doc: Document, pathname: string): DocBootstrap | undefined {
  const data = doc.getElementById('doc-bootstrap')
  const body = doc.getElementById('doc-body')
  if (!data || !body) return undefined
  try {
    const value = JSON.parse(data.textContent ?? '')
    if (
      typeof value.slug !== 'string' ||
      pathname !== `/docs/${value.slug}` ||
      typeof value.content !== 'string' ||
      !Array.isArray(value.headings) ||
      !value.headings.every(
        (heading: DocHeading) =>
          heading &&
          (heading.depth === 2 || heading.depth === 3) &&
          typeof heading.text === 'string' &&
          typeof heading.id === 'string',
      )
    )
      return undefined
    return { ...value, html: body.innerHTML }
  } catch {
    return undefined
  }
}
