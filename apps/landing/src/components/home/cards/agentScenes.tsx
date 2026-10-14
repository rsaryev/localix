import type { CSSProperties } from 'react'
import {
  CornerDownRight,
  FileCode2,
  History,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MousePointer2,
  SquareTerminal,
  UserPlus,
  X,
} from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import {
  ClaudeMark,
  CodexMark,
  CopilotMark,
  GeminiMark,
  HermesMark,
  OpenCodeMark,
} from '@localixai/kit/coding-agent-marks'
import { AgentHeader, Mention, Window } from './chrome'
import { Code } from './highlight'

const order = (i: number) => ({ '--i': i }) as CSSProperties

const team = [
  { id: 'lead', name: 'Team Lead' },
  { id: 'frontend', name: 'Frontend' },
  { id: 'qa', name: 'QA Engineer' },
]

/** The conversation as Localix draws it: participants sit in the composer, the one answering is
 * marked there, and the turn passes from the lead to the frontend. */
export function TeamScene() {
  return (
    <Window tabs={[{ icon: MessageSquare, label: 'Prepare the release', active: true }]}>
      <div className="sc-thread">
        <div className="k-bubble sc-t-ask">
          <Mention id="lead" name="Team Lead" /> Check the release page on mobile.
        </div>
        <div className="sc-msg sc-t-lead">
          <AgentHeader id="lead" name="Team Lead" />
          <p>
            <Mention id="frontend" name="Frontend" /> take the layout at 390px.
          </p>
        </div>
        <div className="sc-turn-note">
          <CornerDownRight className="size-3" /> Turn passed to Frontend
        </div>
        <div className="sc-msg sc-t-front">
          <AgentHeader id="frontend" name="Frontend" />
          <div className="k-swap">
            <span className="sc-typing">
              <i />
              <i />
              <i />
            </span>
            <p>The header wraps at 390px. Fixing it in the preview.</p>
          </div>
        </div>
      </div>
      <div className="k-composer sc-team-composer">
        <div className="sc-participants">
          {team.map((member) => (
            <span key={member.id} className="sc-participant" data-who={member.id}>
              <MonogramAvatar identity={member.id} label={member.name} size={14} />
              {member.name}
              <X className="size-2.5" />
            </span>
          ))}
          <UserPlus className="sc-invite size-3" />
        </div>
        <span className="k-placeholder">Describe the outcome you want…</span>
      </div>
    </Window>
  )
}

const sessions = ['Release notes', 'Fix the login flow', 'Refactor the API client']

const clis = [
  { label: 'Claude Code', Mark: ClaudeMark },
  { label: 'Codex', Mark: CodexMark },
  { label: 'opencode', Mark: OpenCodeMark },
  { label: 'Gemini CLI', Mark: GeminiMark },
  { label: 'GitHub Copilot', Mark: CopilotMark },
  { label: 'Hermes', Mark: HermesMark },
]

/** The installed CLIs: one is picked, a session from its own history resumes in the terminal,
 * and the transcript links into chat. */
export function CliScene() {
  return (
    <Window
      className="sc-cli"
      tabs={[
        { icon: SquareTerminal, label: 'Terminal', active: true },
        { icon: History, label: 'Session history' },
      ]}
    >
      <div className="sc-cli-picker">
        <i className="sc-cli-pick" />
        {clis.map(({ label, Mark }) => (
          <span key={label} title={label}>
            <Mark className="size-3.5" />
          </span>
        ))}
        <span className="sc-cli-name">Claude Code</span>
      </div>
      <div className="sc-cli-body">
        <ul className="sc-sessions">
          {sessions.map((session, i) => (
            <li key={session} style={order(i)} data-picked={i === 0 || undefined}>
              {session}
            </li>
          ))}
        </ul>
        <div className="sc-term k-mono">
          <span className="sc-term-cmd">
            <span className="t-x">~/project $ </span>
            <Code lang="sh">claude --resume</Code>
          </span>
          <span className="sc-term-banner" style={order(0)}>
            <ClaudeMark className="size-3.5" />
            <b>Claude Code</b> Resumed “Release notes”
          </span>
          <span className="sc-term-line" style={order(1)}>
            <span className="t-s">●</span> Updated <span className="t-f">release.ts</span>
          </span>
          <span className="k-chip sc-term-link">
            <Link2 className="size-2.5" /> Transcript linked to chat
          </span>
        </div>
      </div>
    </Window>
  )
}

/** The agent's pointer carries a note across the board into place above the file it is about,
 * then links the two. */
export function SpaceScene() {
  return (
    <Window tabs={[{ icon: LayoutDashboard, label: 'Project Space', active: true }]}>
      <div className="sc-space">
        <div className="sc-note sc-note-plan">
          <span>Release plan</span>
          <p>Scope · Checks · Changelog</p>
        </div>
        <div className="sc-space-column">
          <div className="sc-carry-x">
            <div className="sc-carry-y">
              <div className="sc-note sc-note-idea">
                Check the changelog before tagging.
                <span className="k-cursor sc-space-cursor">
                  <MousePointer2 className="size-3.5 fill-current" />
                  <span>agent</span>
                </span>
              </div>
            </div>
          </div>
          <i className="sc-space-link" />
          <div className="sc-note sc-note-file k-mono">
            <FileCode2 className="size-3" /> release.ts
          </div>
        </div>
      </div>
    </Window>
  )
}
