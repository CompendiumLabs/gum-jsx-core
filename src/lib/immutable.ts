// Browser bundlers can replace this constant with a boolean. An explicit build
// setting takes precedence over the process environment and needs no polyfill.
declare const __GUM_FREEZE__: boolean | undefined

function freeze_enabled(): boolean {
  if (typeof __GUM_FREEZE__ !== 'undefined') {
    if (typeof __GUM_FREEZE__ !== 'boolean') throw new TypeError('__GUM_FREEZE__ must be a boolean')
    return __GUM_FREEZE__
  }
  const env = typeof process === 'undefined' ? undefined : process.env
  const override = env?.GUM_FREEZE
  if (override !== undefined) {
    if (override !== '0' && override !== '1') throw new TypeError('GUM_FREEZE must be 0 or 1')
    return override === '1'
  }
  return env?.NODE_ENV !== 'production'
}

// Select once per module instance. Copying and validation belong to constructors,
// independently of whether readonly values receive runtime mutation protection.
export const FREEZE_ENABLED = freeze_enabled()
export const freeze_owned: typeof Object.freeze = FREEZE_ENABLED
  ? Object.freeze
  : <T>(value: T): T => value
