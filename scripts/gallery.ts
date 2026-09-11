import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, LayoutPass, render_svg, inspect_fragment } from '../index';
import { protocol_demo } from '../examples/protocol';

// Regenerate a compact SVG/tree/PNG gallery from the same source descriptions.
const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : join(examples, 'rendered');
mkdirSync(output, { recursive: true });
const scenes = ['rectangle', 'repeated', 'clipping', 'paragraph', 'typography', 'shapes', 'label'].map(name => {
  const file = join(examples, `${name}.jsx`);
  return { name, element: evaluate(readFileSync(file, 'utf8'), { name: file }) };
});
scenes.push({ name: 'protocol', element: protocol_demo });

for (const { name, element } of scenes) {
  const pass = new LayoutPass();
  const fragment = pass.layout(element);
  const svg = render_svg(fragment, { background: '#f7f8fa', id_prefix: name });
  writeFileSync(join(output, `${name}.svg`), svg + '\n');
  writeFileSync(join(output, `${name}.tree`), inspect_fragment(fragment) + '\n');
  const raster = spawnSync('rsvg-convert', ['--format', 'png'], {
    input: svg, maxBuffer: 64 * 1024 * 1024,
  });
  if (raster.error || raster.status !== 0) {
    throw new Error('Gallery PNG generation requires rsvg-convert', { cause: raster.error });
  }
  writeFileSync(join(output, `${name}.png`), raster.stdout);
  console.log(`${name}: ${fragment.size.width}×${fragment.size.height}; ${JSON.stringify(pass.stats)}`);
}
