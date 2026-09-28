import { FREEZE_ENABLED, freeze_owned } from '../../src/lib/immutable'

// A browser entry with no Node globals, fonts, or DOM requirements.
const result = {
  enabled: FREEZE_ENABLED,
  frozen: Object.isFrozen(freeze_owned({ value: 1 })),
  native_frozen: Object.isFrozen(Object.freeze({ value: 1 })),
}
;(globalThis as typeof globalThis & { freeze_result: typeof result }).freeze_result = result
