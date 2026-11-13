// The architecture, checked: Feature-Sliced Design's rules on src/, and a size limit.
//   1. A layer imports only from the layers under it (app > pages > widgets > features >
//      entities > shared).
//   2. A slice never imports another slice of its own layer (shared has no slices).
//   3. Another slice is imported through its public index, never a file inside it.
//   4. A relative import stays inside its slice.
//   5. Nothing the browser loads reaches entities/doc, the build-time markdown engine.
//   6. No file is longer than 300 lines.
//   7. A colour is a token: no hex colour in a stylesheet outside shared/styles.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const LAYERS = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
const MOST = 300;
const problems = [];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** A file of src/ as its layer and slice: `widgets/hero/Hero.tsx` is in `widgets`, slice `hero`.
 *  The app has no slices; shared's are its segments (`ui`, `lib/cx`, `config`). */
function place(path) {
  const [layer, ...rest] = relative(src, path).split('/');
  if (layer === 'app') return { layer, slice: '' };
  if (layer === 'shared') return { layer, slice: rest[0] === 'lib' ? `lib/${rest[1].replace(/\.\w+$/, '')}` : rest[0] };
  return { layer, slice: rest[0] };
}

const files = walk(src);
const code = files.filter((path) => /\.(ts|tsx)$/.test(path));
const graph = new Map();

for (const path of files) {
  const lines = readFileSync(path, 'utf8').split('\n').length - 1;
  if (lines > MOST) problems.push(`${relative(root, path)}: ${lines} lines (at most ${MOST}; split it by what it does)`);
}

for (const path of files.filter((file) => file.endsWith('.css') && !relative(src, file).startsWith('shared/styles'))) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const colour = /#[0-9a-fA-F]{3,8}\b/.exec(line.replace(/\/\*.*?\*\//g, ''));
      if (colour) problems.push(`${relative(root, path)}:${index + 1}: ${colour[0]} (a colour is a token of src/shared/styles/global.css)`);
    });
}

for (const path of code) {
  const name = relative(root, path);
  const from = place(path);
  const edges = [];
  graph.set(path, edges);
  const text = readFileSync(path, 'utf8');
  for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    // A stylesheet is a file, not a module with a public index.
    if (spec.endsWith('.css')) continue;
    if (spec.startsWith('.')) {
      const target = resolve(dirname(path), spec);
      edges.push(target);
      const to = place(target);
      if (from.layer !== 'app' && (to.layer !== from.layer || to.slice.split('/')[0] !== from.slice.split('/')[0])) {
        problems.push(`${name}: '${spec}' leaves its slice; import the other slice by '@/…'`);
      }
      continue;
    }
    if (!spec.startsWith('@/')) continue;
    const [layer, ...rest] = spec.slice(2).split('/');
    edges.push(join(src, spec.slice(2)));
    const up = LAYERS.indexOf(layer) - LAYERS.indexOf(from.layer);
    if (up > 0) problems.push(`${name}: '${spec}': ${from.layer} may not import from ${layer}, a layer above it`);
    if (up === 0 && layer !== 'shared' && layer !== 'app' && rest[0] !== from.slice) {
      problems.push(`${name}: '${spec}': a slice of ${layer} may not import another slice of ${layer}`);
    }
    const depth = layer === 'shared' ? (rest[0] === 'lib' ? 2 : 1) : 1;
    if (layer !== 'app' && rest.length > depth) {
      problems.push(`${name}: '${spec}' reaches inside a slice; import '@/${[layer, ...rest.slice(0, depth)].join('/')}'`);
    }
  }
}

/** The file an import names: itself, with an extension, or its directory's index. */
function file(target) {
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]) {
    if (graph.has(candidate)) return candidate;
  }
  return undefined;
}

for (const entry of ['app/entry-client.tsx', 'app/entry-docs.ts', 'app/entry-kit.tsx']) {
  const seen = new Set();
  const queue = [[join(src, entry), [entry]]];
  while (queue.length > 0) {
    const [path, trail] = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (relative(src, path).startsWith('entities/doc')) {
      problems.push(`src/${entry}: the browser would load entities/doc, the build-time engine, through ${trail.join(' → ')}`);
      break;
    }
    for (const edge of graph.get(path) ?? []) {
      const next = file(edge);
      if (next) queue.push([next, [...trail, relative(src, next)]]);
    }
  }
}

if (problems.length > 0) {
  console.error(`The architecture's rules are broken:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`layers ok: ${code.length} modules`);
