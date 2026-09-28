import { freeze_owned } from '../lib/immutable'
import type { ReferenceBox } from './units'

const owned_references = new WeakSet<object>()

// Width/height records can be shared by measurement contexts in either mode.
// Keep ownership separate from whether runtime mutation checks are enabled.
function own_reference<T extends ReferenceBox>(reference: T): Readonly<T> {
  owned_references.add(reference)
  return freeze_owned(reference)
}

function snapshot_reference(reference: ReferenceBox): ReferenceBox {
  return owned_references.has(reference) || Object.isFrozen(reference)
    ? reference : own_reference({ ...reference })
}

export { own_reference, snapshot_reference }
