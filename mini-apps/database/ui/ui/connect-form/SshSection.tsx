/** SSH tunnel — network dialects only. */
import { Fingerprint, KeyRound, Network } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { ConnectFormState } from './useConnectForm'

export function SshSection({ f, fid }: { f: ConnectFormState; fid: string }) {
  const s = f.sshState
  return (
    <div className="mt-2.5">
      <label
        htmlFor={`${fid}-ssh-enabled`}
        className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
      >
        <Checkbox
          id={`${fid}-ssh-enabled`}
          checked={s.sshEnabled}
          onChange={(e) => {
            s.setSshEnabled(e.target.checked)
            f.resetTest()
          }}
        />
        <Network className="size-3 text-text-faint" />
        <span className="font-medium text-foreground">Use SSH tunnel</span>
        <span className="text-text-faint">— reach a database via a bastion host</span>
      </label>
      {s.sshEnabled && (
        <div className="mt-2 space-y-2 border-l border-border pl-3">
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label htmlFor={`${fid}-ssh-host`} className="mb-1 block text-2xs text-text-soft">
                SSH host
              </label>
              <Input
                id={`${fid}-ssh-host`}
                value={s.sshHost}
                onChange={(e) => {
                  s.setSshHost(e.target.value)
                  f.resetTest()
                }}
                placeholder="bastion.example.com"
                spellCheck={false}
              />
            </div>
            <div className="w-16">
              <label htmlFor={`${fid}-ssh-port`} className="mb-1 block text-2xs text-text-soft">
                Port
              </label>
              <Input
                id={`${fid}-ssh-port`}
                value={s.sshPort}
                onChange={(e) => {
                  s.setSshPort(e.target.value.replace(/[^0-9]/g, ''))
                  f.resetTest()
                }}
                placeholder="22"
                inputMode="numeric"
                spellCheck={false}
              />
            </div>
          </div>
          <div>
            <label htmlFor={`${fid}-ssh-user`} className="mb-1 block text-2xs text-text-soft">
              SSH user
            </label>
            <Input
              id={`${fid}-ssh-user`}
              value={s.sshUser}
              onChange={(e) => {
                s.setSshUser(e.target.value)
                f.resetTest()
              }}
              placeholder="tunnel"
              spellCheck={false}
            />
          </div>
          <SegmentedControl fullWidth variant="muted" className="h-7">
            <SegmentedControlItem
              active={s.sshAuth === 'password'}
              onClick={() => {
                s.setSshAuth('password')
                f.resetTest()
              }}
            >
              Password
            </SegmentedControlItem>
            <SegmentedControlItem
              active={s.sshAuth === 'key'}
              onClick={() => {
                s.setSshAuth('key')
                f.resetTest()
              }}
            >
              <KeyRound className="size-3" /> Private key
            </SegmentedControlItem>
          </SegmentedControl>
          {s.sshAuth === 'password' ? (
            <div>
              <label htmlFor={`${fid}-ssh-password`} className="mb-1 block text-2xs text-text-soft">
                SSH password
              </label>
              <Input
                id={`${fid}-ssh-password`}
                type="password"
                value={s.sshPassword}
                onChange={(e) => {
                  s.setSshPassword(e.target.value)
                  f.resetTest()
                }}
                placeholder="••••••••  or  ${secret:KEY}"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor={`${fid}-ssh-key`} className="mb-1 block text-2xs text-text-soft">
                  Private key (PEM)
                </label>
                <Textarea
                  id={`${fid}-ssh-key`}
                  value={s.sshPrivateKey}
                  onChange={(e) => {
                    s.setSshPrivateKey(e.target.value)
                    f.resetTest()
                  }}
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…  or  ${secret:KEY}'}
                  spellCheck={false}
                  rows={3}
                  className="resize-y font-mono text-2xs"
                />
              </div>
              <div>
                <label
                  htmlFor={`${fid}-ssh-passphrase`}
                  className="mb-1 block text-2xs text-text-soft"
                >
                  Key passphrase (optional)
                </label>
                <Input
                  id={`${fid}-ssh-passphrase`}
                  type="password"
                  value={s.sshPassphrase}
                  onChange={(e) => {
                    s.setSshPassphrase(e.target.value)
                    f.resetTest()
                  }}
                  placeholder="••••••••  or  ${secret:KEY}"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </>
          )}
          {s.issue && (
            <p role="alert" className="text-2xs text-status-error">
              {s.issue}
            </p>
          )}
          <HostKeyRow
            pinned={s.hostKeyPin}
            forgotten={s.hostKeyForgotten}
            tested={f.testedHostKey}
            onForget={() => {
              s.forgetHostKey()
              f.resetTest()
            }}
          />
          {s.canStoreSshSecret && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
              title="The saved config keeps only a ${secret:…} token, never the raw SSH credential."
            >
              <Checkbox
                checked={s.storeSshSecret}
                onChange={(e) => s.setStoreSshSecret(e.target.checked)}
              />
              <span>
                Store the SSH {s.sshAuth === 'password' ? 'password' : 'key credentials'} as{' '}
                {s.sshAuth === 'password' ? 'a secret' : 'secrets'}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The bastion's host key: the pin this connection verifies against, or — before one exists —
 * what the first connect will trust. Shown rather than silently managed, because trusting a
 * key is a decision the user may want to check against `ssh-keygen -lf` on the bastion.
 */
function HostKeyRow({
  pinned,
  forgotten,
  tested,
  onForget,
}: {
  pinned: string | undefined
  forgotten: boolean
  tested: string | null
  onForget: () => void
}) {
  const shown = pinned ?? tested
  const caption = pinned
    ? 'Host key — trusted'
    : tested
      ? 'Host key — trusted when you save'
      : forgotten
        ? 'Host key forgotten — the next connect trusts the key it meets'
        : 'Host key — trusted on first connect'
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-2xs text-text-soft">
      <Fingerprint className="size-3 shrink-0 text-text-faint" />
      <span className="shrink-0">{caption}</span>
      {shown && (
        <code className="min-w-0 truncate font-mono text-text-faint" title={shown}>
          {shown}
        </code>
      )}
      {pinned && (
        <Button size="xs" variant="ghost" className="ml-auto shrink-0" onClick={onForget}>
          Forget host key
        </Button>
      )}
    </div>
  )
}
