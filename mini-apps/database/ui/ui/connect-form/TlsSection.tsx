/** Field-mode TLS/SSL block: the toggle + the Advanced TLS disclosure (PEM inputs). */
import { ChevronRight } from 'lucide-react'
import { Checkbox } from '@localixai/kit/checkbox'
import { Textarea } from '@localixai/kit/textarea'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { ConnectFormState } from './useConnectForm'

export function TlsSection({ f, fid }: { f: ConnectFormState; fid: string }) {
  return (
    <div>
      <label
        className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
        title="Connect over TLS/SSL."
      >
        <Checkbox
          checked={f.tls}
          onChange={(e) => {
            f.setTls(e.target.checked)
            f.resetTest()
          }}
        />
        <span className="font-medium text-foreground">Use TLS/SSL</span>
      </label>
      {f.tls && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => f.setShowTlsAdv((s) => !s)}
            className="flex items-center gap-1 rounded-sm text-2xs text-text-soft outline-none transition-colors hover:text-foreground focus-ring"
          >
            <ChevronRight
              className={cn('size-3 transition-transform', f.showTlsAdv && 'rotate-90')}
            />
            Advanced TLS
          </button>
          {f.showTlsAdv && (
            <div className="mt-1.5 space-y-2 border-l border-border pl-3">
              <label
                className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
                title="Uncheck to accept a self-signed / untrusted certificate."
              >
                <Checkbox
                  checked={!f.tlsAdv.rejectUnauthorized}
                  onChange={(e) => {
                    f.setTlsAdv((a) => ({ ...a, rejectUnauthorized: !e.target.checked }))
                    f.resetTest()
                  }}
                />
                <span>Accept self-signed / untrusted certificate</span>
              </label>
              <div>
                <label htmlFor={`${fid}-tls-ca`} className="mb-1 block text-2xs text-text-soft">
                  CA certificate (PEM)
                </label>
                <Textarea
                  id={`${fid}-tls-ca`}
                  value={f.tlsAdv.ca}
                  onChange={(e) => {
                    f.setTlsAdv((a) => ({ ...a, ca: e.target.value }))
                    f.resetTest()
                  }}
                  rows={2}
                  spellCheck={false}
                  className="min-h-12 resize-y font-mono text-2xs"
                />
              </div>
              <div>
                <label htmlFor={`${fid}-tls-cert`} className="mb-1 block text-2xs text-text-soft">
                  Client certificate (PEM)
                </label>
                <Textarea
                  id={`${fid}-tls-cert`}
                  value={f.tlsAdv.cert}
                  onChange={(e) => {
                    f.setTlsAdv((a) => ({ ...a, cert: e.target.value }))
                    f.resetTest()
                  }}
                  rows={2}
                  spellCheck={false}
                  className="min-h-12 resize-y font-mono text-2xs"
                />
              </div>
              <div>
                <label htmlFor={`${fid}-tls-key`} className="mb-1 block text-2xs text-text-soft">
                  Client key (PEM)
                </label>
                <Textarea
                  id={`${fid}-tls-key`}
                  value={f.tlsAdv.key}
                  onChange={(e) => {
                    f.setTlsAdv((a) => ({ ...a, key: e.target.value }))
                    f.resetTest()
                  }}
                  rows={2}
                  spellCheck={false}
                  className="min-h-12 resize-y font-mono text-2xs"
                />
                {f.canStoreTlsKey && (
                  <label
                    className="mt-1 flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
                    title="The saved config keeps only a ${secret:…} token, never the raw private key."
                  >
                    <Checkbox
                      checked={f.storeTlsKey}
                      onChange={(e) => f.setStoreTlsKey(e.target.checked)}
                    />
                    <span>Store the client key as a secret</span>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
