import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { evaluate } from '../eval';
import { Svg } from '../elems';
import { LayoutPass } from '../pass';
import { exact, make_request } from '../layout';
import { px } from '../units';
import { render_svg } from '../svg';
import { inspect_fragment } from '../inspect';

const HELP = `Usage: bun scripts/gum.ts [file.jsx] [options]
Read JSX from a file or stdin. Use an explicit <Svg> viewport or both size flags.

  -f, --format svg|png|tree|json   Output format (default: svg or output extension)
  -o, --output file              Write output to a file instead of stdout
      --width pixels            Set the viewport width; requires --height
      --height pixels           Set the viewport height; requires --width
      --ratio number            PNG sampling ratio (default: 1; uses rsvg-convert)
      --background color        Paint the viewport background
      --title text              Add an escaped SVG title
      --id-prefix name          Prefix SVG definition IDs (default: gum)
      --stats                   Print layout counters to stderr
  -h, --help                    Show this help
`;

// CLI sizes are explicit pixels; raster ratio is independent of the layout viewport.
function number_option(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be nonnegative and finite`);
  }
  return number;
}

// The command owns I/O and rasterization. The library stays platform-neutral.
function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: 'string', short: 'f' }, output: { type: 'string', short: 'o' },
      width: { type: 'string' }, height: { type: 'string' }, ratio: { type: 'string' },
      background: { type: 'string' }, title: { type: 'string' },
      'id-prefix': { type: 'string' }, stats: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) { process.stdout.write(HELP); return; }
  if (positionals.length > 1) throw new Error('Expected at most one JSX file');
  const width = number_option(values.width, 'width');
  const height = number_option(values.height, 'height');
  if ((width === undefined) !== (height === undefined)) {
    throw new Error('Set both --width and --height');
  }
  const ratio = number_option(values.ratio, 'ratio') ?? 1;
  if (ratio === 0) throw new Error('ratio must be positive');
  const format = values.format ?? (values.output ? extname(values.output).slice(1) : 'svg');
  if (!['svg', 'png', 'tree', 'json'].includes(format)) throw new Error(`Unknown format: ${format}`);

  const file = positionals[0];
  const code = readFileSync(!file || file === '-' ? 0 : file, 'utf8');
  let element = evaluate(code, { name: file ?? 'stdin.jsx' });
  if (!(element instanceof Svg)) {
    if (width === undefined || height === undefined) {
      throw new Error('Use <Svg width={px(...)} height={px(...)}> or set --width and --height');
    }
    element = new Svg({ width: px(width), height: px(height), children: element });
  }
  const request = width === undefined || height === undefined ? make_request()
    : make_request({ width: exact(width), height: exact(height) });
  const pass = new LayoutPass();
  const fragment = pass.layout(element, request);

  let output: string | Buffer;
  if (format === 'tree') output = inspect_fragment(fragment) + '\n';
  else if (format === 'json') output = JSON.stringify(fragment, null, 2) + '\n';
  else {
    output = render_svg(fragment, {
      background: values.background, title: values.title, id_prefix: values['id-prefix'],
    });
    if (format === 'png') {
      const raster = spawnSync('rsvg-convert', ['--format', 'png', '--zoom', String(ratio)], {
        input: output, maxBuffer: 64 * 1024 * 1024,
      });
      if (raster.error) throw new Error('PNG output requires rsvg-convert', { cause: raster.error });
      if (raster.status !== 0) throw new Error(raster.stderr.toString().trim());
      output = raster.stdout;
    } else output += '\n';
  }
  if (values.output) writeFileSync(values.output, output);
  else process.stdout.write(output);
  if (values.stats) console.error(JSON.stringify(pass.stats));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
