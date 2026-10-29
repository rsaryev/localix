import type { Listing, ListingDetail } from '@localixai/store'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { KIND_LABELS, SIGNATURE_LABELS, TRUST_LABELS, trustOf } from '../model/presentation'

interface Fact {
  label: string
  value: string
  /** A link the value opens. */
  href?: string
}

const factOf = (detail: ListingDetail | undefined, label: string) =>
  detail?.facts.find((fact) => fact.label.toLowerCase() === label.toLowerCase())?.value

/**
 * What a package is, at a glance (`docs/internals/store.md`, "Package page"): kind, category,
 * version, size, source and its trust, whether it runs code, and the other sources that list it.
 * The listing in hand fills it at once; the page's detail adds what only it knows.
 */
export function packageFacts(listing: Listing, detail?: ListingDetail): Fact[] {
  const trust = trustOf(listing)
  const runs = listing.runsCode
  const homepage = listing.homepage ?? factOf(detail, 'Homepage')
  const license = factOf(detail, 'License')
  const size = factOf(detail, 'Size')
  return [
    { label: 'Kind', value: KIND_LABELS[listing.ref.kind].one },
    ...(listing.category ? [{ label: 'Category', value: listing.category }] : []),
    ...(listing.version ? [{ label: 'Version', value: listing.version }] : []),
    ...(size ? [{ label: 'Size', value: size }] : []),
    {
      label: 'Source',
      value: trust ? `${listing.source.label} · ${TRUST_LABELS[trust]}` : listing.source.label,
    },
    ...(listing.signature
      ? [{ label: 'Signature', value: SIGNATURE_LABELS[listing.signature] }]
      : []),
    {
      label: 'Runs code',
      value: runs === 'unknown' ? 'Not known yet' : runs ? 'Yes, on this computer' : 'No',
    },
    ...(listing.alsoIn?.length
      ? [{ label: 'Also in', value: listing.alsoIn.map((source) => source.label).join(', ') }]
      : []),
    ...(license ? [{ label: 'License', value: license }] : []),
    ...(homepage?.startsWith('https://')
      ? [{ label: 'Website', value: homepage.replace(/^https:\/\/(www\.)?/, ''), href: homepage }]
      : []),
  ]
}

function Value({ fact }: { fact: Fact }) {
  return fact.href ? (
    <ExternalAnchor href={fact.href} className="text-foreground underline-offset-2 hover:underline">
      {fact.value}
    </ExternalAnchor>
  ) : (
    <>{fact.value}</>
  )
}

/**
 * The facts as a strip under the header — label over value, cells divided by hairlines, sliding
 * sideways when they do not fit — or, beside the description on a wide pane, as a card.
 */
export function PackageFacts({ facts, as }: { facts: Fact[]; as: 'strip' | 'card' }) {
  if (as === 'card')
    return (
      <section aria-label="Information" className="rounded-xl border border-border-faint p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Information</h2>
        <dl className="flex flex-col gap-2.5 text-xs">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-0.5">
              <dt className="text-text-faint">{fact.label}</dt>
              <dd className="break-words text-text-soft">
                <Value fact={fact} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    )
  return (
    <dl
      aria-label="Information"
      className="flex snap-x overflow-x-auto border-y border-border-faint py-3"
    >
      {facts.map((fact, at) => (
        <div
          key={fact.label}
          className={cn(
            'flex max-w-56 min-w-28 shrink-0 snap-start flex-col gap-0.5 px-4',
            at > 0 && 'border-l border-border-faint',
            at === 0 && 'pl-0',
          )}
        >
          <dt className="text-2xs font-medium tracking-wide text-text-faint uppercase">
            {fact.label}
          </dt>
          <dd className="truncate text-sm text-foreground" title={fact.value}>
            <Value fact={fact} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
