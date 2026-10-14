import type { Action } from './types.js'

/**
 * Lightweight in-memory ranking for action lists.
 * SQLite FTS handles heavy search; this ranks favorites/recents client-side.
 */
export function rankActions(actions: Action[], query: string): Action[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return [...actions].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      const aTime = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0
      const bTime = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0
      if (aTime !== bTime) return bTime - aTime
      return a.name.localeCompare(b.name)
    })
  }

  const scored = actions
    .map((action) => ({ action, score: scoreAction(action, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.action.favorite !== b.action.favorite) return a.action.favorite ? -1 : 1
      return a.action.name.localeCompare(b.action.name)
    })

  return scored.map((x) => x.action)
}

function scoreAction(action: Action, q: string): number {
  const name = action.name.toLowerCase()
  const desc = (action.description ?? '').toLowerCase()
  const tags = action.tags.map((t) => t.toLowerCase())
  const abbrev = (action.trigger?.abbreviation ?? '').toLowerCase()
  const body =
    action.kind === 'text.insert' && action.payload && typeof action.payload === 'object' && 'body' in action.payload
      ? String((action.payload as { body: string }).body).toLowerCase()
      : ''

  let score = 0
  if (name === q) score += 100
  else if (name.startsWith(q)) score += 80
  else if (name.includes(q)) score += 50

  if (abbrev === q) score += 90
  else if (abbrev.startsWith(q)) score += 60

  if (tags.some((t) => t === q)) score += 40
  else if (tags.some((t) => t.includes(q))) score += 20

  if (desc.includes(q)) score += 10
  if (body.includes(q)) score += 5

  if (action.favorite && score > 0) score += 15

  return score
}
