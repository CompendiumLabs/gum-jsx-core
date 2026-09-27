import { parseArgs } from 'node:util'
import { bench, do_not_optimize, run } from 'mitata'

// A setup runs outside timing and returns one synchronous measured operation.
// Keep this small adapter identical in core, math, and maps so each repository
// can run its suite without importing another repository's development files.
export type BenchmarkSetup = () => () => unknown

export async function run_benchmarks(cases: Record<string, BenchmarkSetup>) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      filter: { type: 'string' },
      list: { type: 'boolean' },
      smoke: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    console.log(`Usage: bun run perf [options]

  --filter <regex>  Run cases whose full name matches the expression
  --list            List matching cases without preparing fixtures
  --smoke           Execute each matching case twice without timing
  --json            Print machine-readable results to stdout
  --help, -h        Show this help

Run on an idle machine. Normal runs use Mitata's warmup and sampling defaults.
Times cover one operation as described in test/perf/README.md.`)
    return
  }
  const filter = new RegExp(values.filter ?? '')
  const selected = Object.entries(cases).filter(([name]) => filter.test(name))
  if (!selected.length) throw new Error(`No benchmarks match ${JSON.stringify(values.filter ?? '')}`)
  if (values.list) {
    const names = selected.map(([name]) => name)
    console.log(values.json ? JSON.stringify(names, null, 2) : names.join('\n'))
    return
  }
  if (values.smoke) {
    for (const [name, setup] of selected) {
      const operation = setup()
      for (let i = 0; i < 2; i++) {
        const result = operation()
        if (result == null) throw new Error(`${name} did not return a result`)
        do_not_optimize(result)
      }
      if (!values.json) console.log(`ok - ${name}`)
    }
    console.log(values.json
      ? JSON.stringify({ mode: 'smoke', cases: selected.map(([name]) => name) }, null, 2)
      : `${selected.length} performance cases passed (no timings).`)
    return
  }
  for (const [name, setup] of selected) {
    bench(name, function* () {
      const operation = setup()
      yield operation
    })
  }
  await run({
    throw: true,
    format: values.json ? { json: { samples: false, debug: false } } : { mitata: { name: 'longest' } },
  })
}
