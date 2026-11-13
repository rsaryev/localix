// A highlighter of our own, small on purpose: shell, JSON and YAML as lines of tokens. The landing's
// panels (Code.tsx) and the docs' code blocks (docs/highlight.ts) both read it, and syntax.css
// colours the kinds.

export type Kind =
  | 'prompt'
  | 'cmd'
  | 'flag'
  | 'str'
  | 'op'
  | 'num'
  | 'key'
  | 'lit'
  | 'var'
  | 'comment'
  | 'punct'
  | 'out'
  | 'plain';
export type Token = [Kind, string];
export type Lang = 'shell' | 'json' | 'yaml';

const SHELL =
  /(#.*$|'[^']*'|"(?:[^"\\]|\\.)*"|\s+|\\$|&&|\|\||[|;<]|\d?>>?&?\d?|\$\{?\w+\}?|[^\s|;<>'"$\\]+|.)/g;

/** A shell line: the command, its flags and strings, `$VAR`, pipes and redirects, a `#` comment.
 *  `continued`: the line follows one that ended in `\`, so it starts inside a command. */
export function shellLine(line: string, continued: boolean): Token[] {
  const out: Token[] = [];
  let first = !continued || line.trimStart().startsWith('|');
  for (const text of line.match(SHELL) ?? []) {
    if (/^\s+$/.test(text)) out.push(['plain', text]);
    else if (text.startsWith('#')) out.push(['comment', text]);
    else if (text === '\\') out.push(['op', text]);
    else if (/^(&&|\|\||[|;<]|\d?>)/.test(text)) {
      first = /^(&&|\|\||\||;)$/.test(text);
      out.push(['op', text]);
    } else if (text.startsWith("'") || text.startsWith('"')) out.push(['str', text]);
    else if (text.startsWith('$')) out.push(['var', text]);
    else if (text.startsWith('-')) out.push(['flag', text]);
    else if (first && /^[A-Za-z_]\w*=/.test(text)) {
      const at = text.indexOf('=') + 1;
      out.push(['var', text.slice(0, at)], ['plain', text.slice(at)]);
    } else if (first) {
      first = false;
      out.push(['cmd', text]);
    } else out.push([/^\d+(\.\d+)?$/.test(text) ? 'num' : 'plain', text]);
  }
  return out;
}

/** A shell text. As a `session`, only the `$ ` lines (and those a `\` continues) are commands and
 *  the rest is their output; otherwise (a script) every line is a command. */
function shell(lines: string[], session: boolean): Token[][] {
  return lines.map((line, at) => {
    const continued = at > 0 && (lines[at - 1] ?? '').endsWith('\\');
    const prompt = line.startsWith('$ ');
    if (session && !prompt && !continued) return line ? [['out', line]] : [];
    const body = prompt ? line.slice(2) : line;
    const lead: Token[] = prompt ? [['prompt', '$ ']] : [];
    return [...lead, ...shellLine(body, continued)];
  });
}

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]|\s+|./g;

function jsonLine(line: string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(JSON_TOKEN)) {
    const text = m[0];
    const string = m[1];
    const colon = m[2];
    if (string) {
      out.push([colon ? 'key' : 'str', string]);
      if (colon) out.push(['punct', colon]);
    } else if (/^[{}[\],:]$/.test(text)) out.push(['punct', text]);
    else if (/^-?\d/.test(text)) out.push(['num', text]);
    else if (/^(true|false|null)$/.test(text)) out.push(['lit', text]);
    else out.push(['plain', text]);
  }
  return out;
}

const YAML_VALUE = /('[^']*'|"(?:[^"\\]|\\.)*"|\$\{\{.*?\}\}|(?<=\s|^)#.*$)/;

/** A YAML value: strings, `${{ }}` expressions, a trailing comment, bare numbers and booleans. */
function yamlValue(text: string): Token[] {
  return text
    .split(YAML_VALUE)
    .filter(Boolean)
    .map((part): Token => {
      if (/^['"]/.test(part)) return ['str', part];
      if (part.startsWith('${{')) return ['var', part];
      if (part.startsWith('#')) return ['comment', part];
      return [/^\s*(true|false|null|-?\d+(\.\d+)?)\s*$/.test(part) ? 'lit' : 'plain', part];
    });
}

/** YAML line by line. A block scalar (`key: |`) keeps its lines as written: a script there is text,
 *  and a `#` in it is not a comment (only its `${{ }}` are marked). */
function yaml(lines: string[]): Token[][] {
  let block = -1;
  return lines.map((line) => {
    const indent = line.length - line.trimStart().length;
    if (block >= 0 && (line.trim() === '' || indent > block)) {
      return line
        .split(/(\$\{\{.*?\}\})/)
        .filter(Boolean)
        .map((p): Token => [p.startsWith('${{') ? 'var' : 'plain', p]);
    }
    block = -1;
    if (line.trimStart().startsWith('#')) return [['comment', line]];
    const item = /^(\s*(?:-\s+)?)(?:([A-Za-z0-9_.-]+)(:))?(.*)$/.exec(line);
    const lead = item?.[1] ?? '';
    const rest = item?.[4] ?? '';
    if (/^\s*[|>][-+]?\s*$/.test(rest)) block = item?.[2] ? lead.length : indent;
    const key: Token[] = item?.[2] ? [['key', item[2]], ['punct', item[3] ?? '']] : [];
    return [['plain', lead], ...key, ...yamlValue(rest)];
  });
}

/** A text as lines of tokens. `session` is for shell only (see `shell`). */
export function highlight(text: string, lang: Lang, session = false): Token[][] {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lang === 'json') return lines.map(jsonLine);
  if (lang === 'yaml') return yaml(lines);
  return shell(lines, session);
}

/** A fence's language name as ours, else `undefined`: shown as it is. */
export function langOf(name: string): Lang | undefined {
  if (['bash', 'sh', 'shell', 'zsh'].includes(name)) return 'shell';
  if (name === 'json') return 'json';
  if (name === 'yaml' || name === 'yml') return 'yaml';
  return undefined;
}
