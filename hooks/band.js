// Turns a PulseState into the band's one-row text and risk badge. Pure.

const SEP = ' · '

// Control characters and bidirectional overrides could make a branch name
// draw as something else, so they never reach the band.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/**
 * @param {import('./git-state.js').PulseState} state
 * @returns {string | null}
 */
export function badgeFor(state) {
  if (state.conflicts > 0) return '⚠ CONFLICT'
  if (state.op === 'rebase') return '⚠ REBASE'
  if (state.op === 'merge') return '⚠ MERGE'
  if (state.branch === null) return '⚠ DETACHED'
  return null
}

/**
 * Shortens `s` to at most `max` characters by replacing its middle with `…`.
 * Never returns less than `…`.
 * @param {string} s
 * @param {number} max
 */
export function truncateMiddle(s, max) {
  if (s.length <= max) return s
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return s.slice(0, head) + '…' + (tail > 0 ? s.slice(-tail) : '')
}

/**
 * @param {import('./git-state.js').PulseState} state
 * @param {number} columns width the band row may use
 * @returns {{ text: string, badge: string | null } | null}
 */
export function render(state, columns) {
  if (!state.isRepo) return null

  const badge = badgeFor(state)
  const label = (state.branch ?? '').replace(UNSAFE, '') || 'HEAD@' + (state.sha ?? '?')

  const segments = []
  if (state.dirty > 0) segments.push('±' + state.dirty)
  if (state.hasUpstream) {
    const arrows = []
    if (state.ahead > 0) arrows.push('↑' + state.ahead)
    if (state.behind > 0) arrows.push('↓' + state.behind)
    if (arrows.length > 0) segments.push(arrows.join(' '))
  }
  const tail = segments.map((s) => SEP + s).join('')

  // The badge is drawn after the text with a one-column gap.
  const reserved = tail.length + (badge ? badge.length + 1 : 0)
  const room = Math.max(1, columns - reserved)
  return { text: truncateMiddle(label, room) + tail, badge }
}
