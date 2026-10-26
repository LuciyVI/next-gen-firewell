import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = await realpath(resolve(root, 'dist'));
const outputPath = resolve(dist, 'packet-control.html');
let html = await readFile(resolve(dist, 'index.html'), 'utf8');

async function readAsset(url) {
  if (!url || /^(?:[a-z]+:|\/\/)/i.test(url) || /[?#]/.test(url)) {
    throw new Error(`Standalone export requires a local build asset: ${url}`);
  }
  const path = await realpath(resolve(dist, url.replace(/^\//, '')));
  const local = relative(dist, path);
  if (local === '..' || local.startsWith(`..${sep}`)) {
    throw new Error(`Build asset escapes dist/: ${url}`);
  }
  return readFile(path, 'utf8');
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((match) => [match[1], match[3]]));
}

const resourceLinks = [...html.matchAll(/<link\b[^>]*>/gi)];
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi)];
if (scripts.length !== 1) throw new Error(`Expected one bundled script, found ${scripts.length}. Code splitting needs explicit export support.`);
for (const [tag] of scripts) {
  const { src, type } = attributes(tag);
  const js = await readAsset(src);
  // Fail rather than ship a file that tries to import sibling chunks or network modules.
  if (/\bimport\s*(?:\(|["'{*])/.test(js) || /\b(?:import|export)\b[^;\n]*\bfrom\s*["']/.test(js)) {
    throw new Error(`Bundle ${src} contains module imports; standalone export requires a self-contained bundle.`);
  }
  html = html.replace(tag, () => `<script${type ? ` type="${type}"` : ''}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
}

let styles = 0;
let icons = 0;
for (const [tag] of resourceLinks) {
  const { rel, href } = attributes(tag);
  if (rel === 'stylesheet') {
    const css = await readAsset(href);
    if (/@import\b/i.test(css)) throw new Error(`Stylesheet ${href} contains an external import.`);
    for (const match of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      if (!/^(?:data:|#)/i.test(match[2])) throw new Error(`Stylesheet ${href} references a non-inline asset: ${match[2]}`);
    }
    html = html.replace(tag, () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`);
    styles += 1;
  } else if (rel === 'icon') {
    if (extname(href) !== '.svg') throw new Error(`Unsupported favicon type: ${href}`);
    const svg = await readAsset(href);
    const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    html = html.replace(tag, () => `<link rel="icon" type="image/svg+xml" href="${uri}">`);
    icons += 1;
  } else {
    throw new Error(`Unsupported resource link in build: ${tag}`);
  }
}
if (!styles || icons !== 1) throw new Error('Expected at least one stylesheet and exactly one favicon.');
await writeFile(outputPath, html);
console.log(`Standalone game exported: ${outputPath} (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)`);
