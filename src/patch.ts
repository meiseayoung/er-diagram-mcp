import type { ERDiagramData } from '$er/types.js'
import {
  applyPatchesToData,
  type PatchOperation,
  type PatchResult
} from '$er/patchSchema.js'

import { updateSchema } from './session.js'

export type { PatchOperation, PatchResult }

export function applyPatches(operations: PatchOperation[]): PatchResult {
  const base = updateSchema((data) => data)
  const result = applyPatchesToData(base, operations)
  updateSchema(() => result.schema)
  return result
}
