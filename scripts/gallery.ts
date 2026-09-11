import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, LayoutPass, render_svg, inspect_fragment, make_request, exact } from '../index';
import type { Element, LayoutRequest } from '../index';
import { protocol_demo } from '../examples/protocol';

type Scene = { name: string; element: Element; request?: LayoutRequest };

// Regenerate a compact SVG/tree/PNG gallery from the same source descriptions.
const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : join(examples, 'rendered');
mkdirSync(output, { recursive: true });
const names = ['rectangle', 'repeated', 'clipping', 'paragraph', 'typography', 'shapes', 'label',
  'hugging', 'card', 'nesting', 'box_clip', 'fitting', 'fill_rect', 'fill_ellipse'];
const scenes: Scene[] = names.map(name => {
  const file = join(examples, `${name}.jsx`);
  return { name, element: evaluate(readFileSync(file, 'utf8'), { name: file }) };
});
scenes.push({ name: 'protocol', element: protocol_demo });
// The same source card also answers a narrower viewport request.
const card = scenes.find(scene => scene.name === 'card')!;
scenes.push({ ...card, name: 'card_narrow', request: make_request({ width: exact(220) }) });

for (const { name, element, request } of scenes) {
  const pass = new LayoutPass();
  const fragment = pass.layout(element, request);
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
