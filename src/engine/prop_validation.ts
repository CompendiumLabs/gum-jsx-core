// Register exact constructors: application subclasses remain extensible unless
// they explicitly opt in. Built-in schemas are generated from their input types.
const schemas = new WeakMap<Function, ReadonlySet<string>>()

function register_props(ctor: Function, keys: readonly string[] | string): void {
  schemas.set(ctor, new Set(typeof keys === 'string' ? keys.split(' ') : keys))
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  let previous: number[] = []
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1,
        row[j - 1] + Number(a[i - 1] !== b[j - 1]))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        next[j] = Math.min(next[j], previous[j - 2] + 1)
      }
    }
    previous = row
    row = next
  }
  return row[b.length]
}

function validate_props(ctor: Function, props: object): void {
  const allowed = schemas.get(ctor)
  if (!allowed) return
  for (const key of Object.keys(props)) {
    if (allowed.has(key)) continue
    const candidates = [...allowed].map(name => ({ name, score: distance(key, name) }))
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    const best = candidates[0]
    const hint = best && best.score <= Math.max(1, Math.floor(key.length / 3))
      ? `Did you mean "${best.name}"?` : 'Check this element’s supported props.'
    const name = (ctor as { element_name?: string }).element_name || ctor.name
    throw new TypeError(`${name}: unknown prop "${key}". ${hint}`)
  }
}

export { register_props, validate_props }
