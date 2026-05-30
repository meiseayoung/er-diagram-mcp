import type { ERDiagramData } from '$er/types.js'

const emptySchema = (): ERDiagramData => ({ tables: [], relations: [] })

let current: ERDiagramData = emptySchema()

export function getSchema(): ERDiagramData {
  return structuredClone(current)
}

export function setSchema(data: ERDiagramData): void {
  current = structuredClone(data)
}

export function resetSchema(): void {
  current = emptySchema()
}

export function updateSchema(mutator: (draft: ERDiagramData) => void): ERDiagramData {
  const draft = structuredClone(current)
  mutator(draft)
  current = draft
  return getSchema()
}
