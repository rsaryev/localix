/**
 * EVERY ENHANCER THAT CLAIMS THIS FILE, WRAPPED AROUND THE EDITOR.
 *
 * A file-editor enhancer contributes hooks, not chrome: git's dirty-diff gutter reads the file's
 * base blob and hands the editor a decoration set. It cannot be a plain component beside the
 * editor, because what it computes has to reach INSIDE — so each enhancer is given a `render`
 * callback and passes its contribution down through it.
 *
 * Several enhancers nest, outermost first, each merging its contribution into what the ones
 * outside it produced. The editor at the centre receives one object — it never learns how many
 * mini apps are installed, which is the whole point of the seam.
 *
 * WHY THE CHAIN IS KEYED BY PATH. An enhancer's hooks are scoped to a file: switching the tab to
 * another file must tear them down rather than let them answer the new file with the old one's
 * state. React reuses a component instance at the same position, so without a key the git gutter
 * kept the previous file's base blob through a switch and drew its diff over the new content.
 *
 * The enhancers are a registry SLICE keyed by path rather than a read per render: a mini app can
 * register after the first paint (they load lazily), and a read at render showed that file's
 * editor unenhanced until something else re-rendered the editor.
 */
import { Fragment, type ComponentType, type ReactNode } from 'react'

import type { FileEditorEnhancerContribution } from '@localixai/mini-app-sdk/ui'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'
import { fileEditorEnhancersFor } from '@/shared/contrib/fileEditorEnhancers'
import { useMiniAppRegistrySlice } from '@/shared/contrib/useMiniAppRegistrySlice'

export interface FileEditorEnhancementsProps {
  /** The file being edited — what each enhancer matches on and scopes its hooks to. */
  path: string
  /** The session the file is open in; an enhancer's reads are scoped to it. */
  sessionId?: string
  /** The editor, given everything the enhancers computed. */
  children: (enhancement: Readonly<Record<string, unknown>>) => ReactNode
  /** Anything else the editor surface passes through to its enhancers. */
  [prop: string]: unknown
}

export function FileEditorEnhancements({
  children,
  ...props
}: FileEditorEnhancementsProps): ReactNode {
  const enhancers = useMiniAppRegistrySlice(`enhancers:${props.path}`, () =>
    fileEditorEnhancersFor(props.path),
  )
  return nest(enhancers, props, {}, children)
}

/**
 * Wrap `rest` around `inner`, outermost first, threading each one's contribution inward.
 *
 * Recursive rather than a fold because each enhancer must RENDER the next: its contribution only
 * exists inside its own subtree (it comes from hooks), so the next enhancer has to be a child of
 * it rather than a sibling.
 */
function nest(
  enhancers: readonly FileEditorEnhancerContribution[],
  props: Record<string, unknown>,
  gathered: Readonly<Record<string, unknown>>,
  inner: (enhancement: Readonly<Record<string, unknown>>) => ReactNode,
): ReactNode {
  const [enhancer, ...rest] = enhancers
  if (!enhancer) return <Fragment>{inner(gathered)}</Fragment>
  // Each enhancer is mini app code on the editor's render path, so each gets its own boundary: one
  // that throws loses its own decoration and the editor still opens, where a single boundary
  // around the chain would take the file's content down with it. The `key` carries the path for
  // the same reason it does below — a boundary deliberately does not reset itself on new props.
  // The enhancer's props are the editor's, which this module does not model — the host narrows
  // them on its side and the SDK's `FileEditorEnhancerProps` states the one field it adds. Cast
  // once, here, rather than duplicating the editor's prop type into the seam.
  const Component = enhancer.Component as unknown as ComponentType<Record<string, unknown>>
  // Only a STRING path joins the key. These props are the editor's and untyped at this seam, and
  // anything else would stringify to "[object Object]" — one key shared by every file, which is
  // the instance reuse the key exists to prevent.
  const path = typeof props.path === 'string' ? props.path : ''
  const key = `${enhancer.id} ${path}`
  return (
    <SurfaceErrorBoundary key={key} surface={`The ${enhancer.id} editor enhancer`}>
      <Component
        {...props}
        render={(contribution: Readonly<Record<string, unknown>>) =>
          nest(rest, props, { ...gathered, ...contribution }, inner)
        }
      />
    </SurfaceErrorBoundary>
  )
}
