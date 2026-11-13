import '../styles/syntax.css';
import type { Token } from '@/shared/lib/highlight';

/** One line of tokens, each in its colour (syntax.css). */
export function Tokens({ line }: { line: Token[] }) {
  return (
    <>
      {line.map(([kind, text], at) => (
        <span key={at} className={kind === 'plain' ? undefined : `tk-${kind}`}>
          {text}
        </span>
      ))}
    </>
  );
}
