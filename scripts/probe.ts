import { probes } from '../test/fixtures/contracts'

// Run the contract gallery, or inspect a single named example as JSON.
const name = process.argv[2]
const entries = Object.entries(probes).filter(([key]) => !name || key === name)
if (entries.length === 0) {
  throw new Error(`Unknown probe ${name}; choose from ${Object.keys(probes).join(', ')}`)
}
const results = Object.fromEntries(entries.map(([key, probe]) => [key, probe()]))
console.log(JSON.stringify(results, null, 2))
