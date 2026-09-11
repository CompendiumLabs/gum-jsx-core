import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../scripts/gum.ts', import.meta.url));
const code = '<Svg width={px(32)} height={px(20)}><Rect width={1} height={1} fill="red"/></Svg>';
const directory = mkdtempSync(join(tmpdir(), 'gum-next-cli-'));

// Exercise actual stdin, options, files, viewport resizing, and raster sampling.
try {
  const tree = spawnSync(process.execPath, [cli, '-f', 'tree', '--stats'], { input: code });
  assert.equal(tree.status, 0, tree.stderr.toString());
  assert.match(tree.stdout.toString(), /^Svg 32×20/);
  assert.deepEqual(JSON.parse(tree.stderr.toString()), { queries: 2, layouts: 2, hits: 0 });

  const resized = spawnSync(process.execPath, [cli, '-f', 'json', '--width', '64', '--height', '40'], {
    input: code,
  });
  assert.equal(resized.status, 0, resized.stderr.toString());
  const fragment = JSON.parse(resized.stdout.toString());
  assert.deepEqual(fragment.size, { width: 64, height: 40 });
  assert.deepEqual(fragment.children[0].fragment.size, { width: 64, height: 40 });
  const empty = spawnSync(process.execPath, [cli, '-f', 'tree', '--width', '0', '--height', '20'], {
    input: code,
  });
  assert.equal(empty.status, 0, empty.stderr.toString());
  assert.match(empty.stdout.toString(), /^Svg 0×20/);

  const file = join(directory, 'rect.svg');
  const svg = spawnSync(process.execPath, [cli, '-o', file, '--width', '32', '--height', '20'], {
    input: '<Rect width={1} height={1} stroke_width={px(2)}/>',
  });
  assert.equal(svg.status, 0, svg.stderr.toString());
  assert.equal(svg.stdout.length, 0);
  assert.match(readFileSync(file, 'utf8'), /stroke-width="2"/);

  const paragraph = '<Svg width={px(160)} height={px(80)}>'
    + '<Text font_size={px(18)}>Real <Span font_weight={700}>text</Span> wraps here.</Text></Svg>';
  const text_svg = spawnSync(process.execPath, [cli, '-f', 'svg'], { input: paragraph });
  assert.equal(text_svg.status, 0, text_svg.stderr.toString());
  assert.match(text_svg.stdout.toString(), /<path d="M/);
  assert.match(text_svg.stdout.toString(), /aria-label="Real text wraps here\."/);

  const one_axis = spawnSync(process.execPath, [cli, '-f', 'tree', '--width', '64'], { input: code });
  assert.equal(one_axis.status, 0, one_axis.stderr.toString());
  assert.match(one_axis.stdout.toString(), /^Svg 64×20/);
  const hugging = '<Box padding={px(8)} border_width={px(2)}><Square width={px(20)}/></Box>';
  const bare = spawnSync(process.execPath, [cli, '-f', 'tree'], { input: hugging });
  assert.equal(bare.status, 0, bare.stderr.toString());
  assert.match(bare.stdout.toString(), /^Svg 40×40/);
  const natural_height = spawnSync(process.execPath, [cli, '-f', 'json', '--width', '120'], {
    input: '<Box padding={px(8)}><Text>Real text wraps into a content-sized height.</Text></Box>',
  });
  assert.equal(natural_height.status, 0, natural_height.stderr.toString());
  const card = JSON.parse(natural_height.stdout.toString());
  assert.equal(card.size.width, 120);
  assert.ok(card.size.height > 40);

  const converter = spawnSync('rsvg-convert', ['--version']);
  if (converter.error) console.log('skip - PNG CLI check (rsvg-convert is not installed)');
  else {
    const png = spawnSync(process.execPath, [cli, '-f', 'png', '--ratio', '2'], { input: code });
    assert.equal(png.status, 0, png.stderr.toString());
    assert.deepEqual([...png.stdout.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.stdout.readUInt32BE(16), 64);
    assert.equal(png.stdout.readUInt32BE(20), 40);
    const text_png = spawnSync(process.execPath, [cli, '-f', 'png'], { input: paragraph });
    assert.equal(text_png.status, 0, text_png.stderr.toString());
    assert.equal(text_png.stdout.readUInt32BE(16), 160);
    assert.equal(text_png.stdout.readUInt32BE(20), 80);
    const box_png = spawnSync(process.execPath, [cli, '-f', 'png'], { input: hugging });
    assert.equal(box_png.status, 0, box_png.stderr.toString());
    assert.equal(box_png.stdout.readUInt32BE(16), 40);
    assert.equal(box_png.stdout.readUInt32BE(20), 40);
    console.log('ok - PNG sampling changes pixel dimensions without changing layout');
  }
  console.log('ok - CLI stdin, tree, JSON, SVG files, resizing, and diagnostics');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
