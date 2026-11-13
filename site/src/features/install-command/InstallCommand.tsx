import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { shellLine } from '@/shared/lib/highlight';
import { Check, Copy, Tokens } from '@/shared/ui';
import './InstallCommand.css';

/** The install command in one frame, as a code block of the docs is: a bar with the ways in (tabs,
 *  only when there are several) and Copy, and under it the command, whole: it wraps rather than
 *  hiding its end. */
export function InstallCommand({ tabs }: { tabs: readonly (readonly [string, string])[] }) {
  const [shown, setShown] = useState(0);
  const command = tabs[shown]?.[1] ?? '';
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const several = tabs.length > 1;

  const show = (at: number) => {
    setShown(at);
    setCopied(false);
  };
  /** The tabs as one stop of the keyboard, the arrows moving between them (WAI-ARIA's tabs). */
  const move = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step && (shown + step + tabs.length) % tabs.length;
    if (to === undefined) return;
    event.preventDefault();
    show(to);
    row.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[to]?.focus();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const copyButton = (
    <button type="button" className="install-copy" onClick={copy} aria-label="Copy the install command">
      {copied ? <Check /> : <Copy />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );

  return (
    <div className={several ? 'install-box tabbed' : 'install-box'}>
      {several && (
        <div className="install-bar">
          <div ref={row} className="install-tabs" role="tablist" aria-label="Ways to install" onKeyDown={move}>
            {tabs.map(([name], at) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`${id}-tab-${at}`}
                aria-selected={at === shown}
                aria-controls={`${id}-panel`}
                tabIndex={at === shown ? 0 : -1}
                onClick={() => show(at)}
              >
                {name}
              </button>
            ))}
          </div>
          {copyButton}
        </div>
      )}
      <div className="install" {...(several && { id: `${id}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-tab-${shown}` })}>
        <code>
          <span className="tk-prompt" aria-hidden="true">$ </span>
          <span className="install-line">
            <Tokens line={shellLine(command, false)} />
          </span>
        </code>
        {!several && copyButton}
      </div>
    </div>
  );
}
