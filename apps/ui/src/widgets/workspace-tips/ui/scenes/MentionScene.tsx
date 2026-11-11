import type { ReactNode } from 'react'
import {
  ChevronDown,
  File,
  Folder,
  Link2,
  MessagesSquare,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react'
import { fileIcon, folderIcon } from '@/shared/ui/file-icon/fileIcon'
import './mention-scene.css'

function FileGlyph({ name, dir }: { name: string; dir?: boolean }) {
  const { Icon, color } = dir ? folderIcon(false) : fileIcon(name)
  return <Icon className={`wt-mn-glyph ${color}`} />
}

/** One row of the `@` menu: glyph, label, faint location — as `AtRefMenu` lays it out. */
function Row({
  glyph,
  label,
  hint,
  active,
  keys,
}: {
  glyph: ReactNode
  label: string
  hint?: string
  active?: boolean
  keys?: string
}) {
  return (
    <span className="wt-mn-row" data-active={active || undefined}>
      {glyph}
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
      {keys ? <span className="wt-mn-keys">{keys}</span> : null}
    </span>
  )
}

/**
 * The composer's `@` flow, step by step as it really runs: the reference kinds; `@file:`
 * turns into a crumb and lists the project; typing narrows it; a folder offers "Link this
 * folder" or going deeper; linking clears the input and the Context chip counts it.
 */
export function MentionScene() {
  return (
    <div aria-hidden className="wt-mention">
      <div className="wt-pane wt-mn-menu">
        <div className="wt-mn-step wt-mn-s1">
          <Row
            glyph={<File className="wt-mn-glyph" />}
            label="@file:"
            hint="Attach file contents"
            active
          />
          <Row
            glyph={<Folder className="wt-mn-glyph" />}
            label="@folder:"
            hint="Attach a directory listing"
          />
          <Row
            glyph={<MessagesSquare className="wt-mn-glyph" />}
            label="@session:"
            hint="Link another chat session"
          />
          <Row
            glyph={<SquareTerminal className="wt-mn-glyph" />}
            label="@terminal:"
            hint="Link an open terminal"
          />
        </div>
        <div className="wt-mn-step wt-mn-s2">
          <Row
            glyph={<FileGlyph name="src" dir />}
            label="src/"
            hint="./"
            active
            keys="↵ open · → link"
          />
          <Row glyph={<FileGlyph name="docs" dir />} label="docs/" hint="./" />
          <Row glyph={<FileGlyph name="index.html" />} label="index.html" hint="./" />
          <Row glyph={<FileGlyph name="package.json" />} label="package.json" hint="./" />
        </div>
        <div className="wt-mn-step wt-mn-s3">
          <Row
            glyph={<FileGlyph name="src" dir />}
            label="src/"
            hint="./"
            active
            keys="↵ open · → link"
          />
          <Row glyph={<FileGlyph name="release.ts" />} label="release.ts" hint="src" />
          <Row glyph={<FileGlyph name="release.test.ts" />} label="release.test.ts" hint="src" />
        </div>
        <div className="wt-mn-step wt-mn-s4">
          <span className="wt-label wt-mn-group">Actions</span>
          <Row
            glyph={<Link2 className="wt-mn-glyph" />}
            label="Link this folder"
            hint="src"
            active
            keys="↵ link"
          />
          <span className="wt-label wt-mn-group">Go deeper</span>
          <Row glyph={<FileGlyph name="release.ts" />} label="release.ts" hint="src/" />
        </div>
      </div>

      <div className="wt-mn-chips">
        <span className="wt-chip">
          <Folder /> my-app
        </span>
        <span className="wt-chip">
          <ShieldCheck /> Default <ChevronDown />
        </span>
        <span className="wt-chip wt-mn-context">
          <Link2 /> Context <span className="wt-count">1</span> <ChevronDown />
        </span>
      </div>
      <div className="wt-pane wt-mn-composer">
        <span className="wt-mn-input">
          <span className="wt-mn-ph">Describe the outcome you want…</span>
          <span className="wt-mn-at">@</span>
          <span className="wt-mn-crumb">
            <span className="wt-mn-c1">@file:</span>
            <span className="wt-mn-c2">@file:src</span>
            <span className="wt-mn-c3">@file:src/</span>
          </span>
          <span className="wt-mn-caret" />
        </span>
      </div>
    </div>
  )
}
