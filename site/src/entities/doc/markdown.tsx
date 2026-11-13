import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Code, Markdown, childrenToText, defaultUrlTransform, isCodeBlock, type MarkdownComponents } from '@localix-ai/flowdown';
import { highlight } from '@localix-ai/flowdown/highlight';
import { html as rawHtml } from '@localix-ai/flowdown/html';
import { extractHeadings, splitBlocks } from '@localix-ai/flowdown/remark';

/** A heading of a page, for its table of contents. */
export type Heading = { depth: number; id: string; text: string };

/** A page's markdown, read, and held to the docs' standard (content/docs/writing-docs.md): one
 *  title, a paragraph after it, no heading level skipped. The title (its first heading, taken
 *  out of the body, which the page draws itself), the opening paragraph as plain text, every
 *  heading with its id, and the body left to render once its links are known. */
export type Read = { title: string; titleId: string; summary: string; headings: Heading[]; body: string };

/** Where a link or a picture of the markdown goes on the site. */
export type Rewrite = (href: string, image: boolean) => string;

/** A section's heading with the `#` that links to it, shown on hover. */
function section(Tag: 'h2' | 'h3') {
  return function Section({ id, children }: ComponentProps<'h2'>) {
    return (
      <Tag id={id}>
        {children}
        {id && (
          <a className="hash" href={`#${id}`} aria-hidden="true" tabIndex={-1}>
            #
          </a>
        )}
      </Tag>
    );
  };
}

/** Inline code breaks at its spaces, never after a flag's `--`: a short flag stays whole, and a
 *  longer one breaks only at an inner hyphen, so a table's column still fits a phone. A URL is
 *  no flag: it may break where it must, or it runs off a phone's screen. */
function unbroken(word: string, at: number): ReactNode {
  if (!word.includes('-') || word.includes('://')) return word;
  const whole = word.length <= 16 ? word : (/^-*[^-]+/.exec(word)?.[0] ?? word);
  return [
    <span key={at} className="nobr">
      {whole}
    </span>,
    word.slice(whole.length),
  ];
}

/** A fence's language as a reader names it; one not here is shown in capitals. */
const LANGUAGES: Record<string, string> = {
  bash: 'Shell', sh: 'Shell', shell: 'Shell', zsh: 'Shell', css: 'CSS', html: 'HTML', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', jsonc: 'JSON', markdown: 'Markdown', md: 'Markdown', text: 'Plain text', ts: 'TypeScript', tsx: 'TSX',
  yaml: 'YAML', yml: 'YAML', toml: 'TOML', diff: 'Diff',
};

const COMPONENTS: MarkdownComponents = {
  h2: section('h2'),
  h3: section('h3'),
  code(props: ComponentProps<typeof Code>) {
    if (isCodeBlock(props.children, props.className)) return <Code {...props} />;
    return <code>{childrenToText(props.children).split(/(\s+)/).map(unbroken)}</code>;
  },
};

/** flowdown at build time: GitHub's markdown and its own forms (callouts, steps, tabs, file
 *  trees), every fenced language highlighted, as static HTML. The page's script only answers a
 *  press (Copy, a tab). */
function draw(markdown: string, rewrite: Rewrite, className = ''): string {
  const page = (
    <Markdown
      headingIds
      highlight={highlight}
      html={rawHtml}
      components={COMPONENTS}
      className={className}
      urlTransform={(url, key) => {
        const safe = defaultUrlTransform(url);
        return safe ? rewrite(safe, key === 'src') : safe;
      }}
    >
      {markdown}
    </Markdown>
  );
  // React hoists a preload for every picture: a docs page loads its pictures as it reaches them.
  // A static page has nothing to download a block with: only Copy stays in a code block's bar.
  return renderToStaticMarkup(page)
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/<button type="button" class="fd-code-download".*?<\/button>/g, '')
    .replace(/(<span class="fd-code-language">)([^<]+)/g, (_, open: string, name: string) => `${open}${LANGUAGES[name] ?? name.toUpperCase()}`);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };

/** A block of markdown as plain text, whitespace collapsed: the words alone, whatever marks them. */
function plain(markdown: string): string {
  return draw(markdown, (href) => href)
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (all, name: string) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ')
    .trim();
}

export function read(markdown: string): Read {
  // A link's reference (`[name]: other.md`) holds the whole document as one block, since any
  // block may use it; the page's shape is read without them. They stay in what is drawn.
  const blocks = splitBlocks(markdown.replace(/^ {0,3}\[[^\]\n]+\]:[ \t]+\S.*$/gm, ''));
  const first = blocks[0];
  const title = first && /^#\s/.test(first.source) ? extractHeadings(first.source)[0] : undefined;
  if (!first || !title) throw new Error('a doc starts with its title, a # heading');
  const body = markdown.slice(first.offset + first.source.length);
  // The sections are the headings of the page itself: one in a quote (a tab's name) is no section.
  const own = blocks.slice(1).flatMap((block) => (/^#{2,6}\s/.test(block.source) ? [extractHeadings(block.source)[0]?.text] : []));
  const headings = extractHeadings(body).filter((heading) => heading.text === own[0] && own.shift() !== undefined);
  if (headings.some((heading) => heading.id === title.id)) {
    throw new Error(`a section is named as the page is ("${title.text}"): their anchors would be one`);
  }
  if (blocks.slice(1).some((block) => /^#\s/.test(block.source))) throw new Error('a doc has one title: a second # heading');
  let depth = 1;
  for (const heading of headings) {
    if (heading.depth > depth + 1) throw new Error(`"${heading.text}" skips a heading level (h${depth} to h${heading.depth})`);
    depth = heading.depth;
  }
  // The description is the paragraph that opens the page, before its first section.
  const section = blocks.findIndex((block, at) => at > 0 && /^#{2,}\s/.test(block.source));
  const opening = blocks.slice(1, section < 0 ? undefined : section);
  const summary = plain(opening.find((block) => /^(?!```|~~~)[^\s#>|<!-]/.test(block.source))?.source ?? '');
  if (!summary) throw new Error('a doc opens with a paragraph after its title: its description');
  return { title: title.text, titleId: title.id, summary, headings, body };
}

/** A page's body as HTML, each link and picture going where `rewrite` says. */
export function render(body: string, rewrite: Rewrite): string {
  return draw(body, rewrite, 'prose');
}

/** A piece of markdown as the HTML a docs page gives it, with no page around it: the kit's
 *  specimen of prose. */
export function renderMarkdown(markdown: string): string {
  return draw(markdown, (href) => href, 'prose');
}
