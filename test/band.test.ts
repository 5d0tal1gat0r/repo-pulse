import { expect, test } from 'claude-code/testing'
import { badgeFor, render, truncateMiddle } from '../hooks/band.js'
import { NOT_A_REPO } from '../hooks/git-state.js'

const BASE = { ...NOT_A_REPO, isRepo: true, branch: 'main', sha: 'abc1234', hasUpstream: true }

test('nothing outside a repository', () => {
  expect(render(NOT_A_REPO, 80)).toBe(null)
})

test('a clean branch shows only its name', () => {
  expect(render(BASE, 80)).toEqual({ text: 'main', badge: null })
})

test('dirty count', () => {
  expect(render({ ...BASE, dirty: 3 }, 80)!.text).toBe('main · ±3')
})

test('ahead and behind, each hidden at zero', () => {
  expect(render({ ...BASE, ahead: 1, behind: 2 }, 80)!.text).toBe('main · ↑1 ↓2')
  expect(render({ ...BASE, ahead: 1 }, 80)!.text).toBe('main · ↑1')
  expect(render({ ...BASE, behind: 4 }, 80)!.text).toBe('main · ↓4')
})

test('all segments together', () => {
  expect(render({ ...BASE, dirty: 2, ahead: 1, behind: 2 }, 80)!.text).toBe('main · ±2 · ↑1 ↓2')
})

test('no upstream hides ahead and behind', () => {
  expect(render({ ...BASE, branch: 'feature', hasUpstream: false, ahead: 5 }, 80)!.text).toBe('feature')
})

test('detached HEAD shows the sha and a badge', () => {
  expect(render({ ...BASE, branch: null }, 80)).toEqual({ text: 'HEAD@abc1234', badge: '⚠ DETACHED' })
})

test('badge priority: conflict, then rebase or merge, then detached', () => {
  expect(badgeFor({ ...BASE, conflicts: 1, op: 'merge' })).toBe('⚠ CONFLICT')
  expect(badgeFor({ ...BASE, branch: null, op: 'rebase' })).toBe('⚠ REBASE')
  expect(badgeFor({ ...BASE, op: 'merge' })).toBe('⚠ MERGE')
  expect(badgeFor({ ...BASE, branch: null })).toBe('⚠ DETACHED')
  expect(badgeFor(BASE)).toBe(null)
})

test('a long branch is shortened in the middle; counts are kept', () => {
  const s = { ...BASE, branch: 'feature/very-long-branch-name-here', dirty: 2 }
  expect(render(s, 20)!.text).toBe('feature…me-here · ±2')
})

test('the badge takes room from the branch, not the counts', () => {
  const s = { ...BASE, branch: 'feature/very-long-branch-name-here', op: 'merge' as const }
  expect(render(s, 20)).toEqual({ text: 'featur…-here', badge: '⚠ MERGE' })
})

test('a very narrow band keeps one character of branch', () => {
  const s = { ...BASE, branch: 'feature/x', dirty: 2 }
  expect(render(s, 3)!.text).toBe('… · ±2')
})

test('a non-ASCII branch that fits is shown unchanged', () => {
  expect(render({ ...BASE, branch: 'feat/ünï' }, 80)!.text).toBe('feat/ünï')
})

test('truncateMiddle', () => {
  expect(truncateMiddle('abcdef', 6)).toBe('abcdef')
  expect(truncateMiddle('abcdef', 5)).toBe('ab…ef')
  expect(truncateMiddle('abcdef', 4)).toBe('ab…f')
  expect(truncateMiddle('abcdef', 2)).toBe('a…')
  expect(truncateMiddle('abcdef', 1)).toBe('…')
  expect(truncateMiddle('abcdef', 0)).toBe('…')
})

test('direction overrides and control characters are stripped from the branch', () => {
  const branch = 'main\u202Egnp.exe\u2066x\u2069\u200E\u200F\u0007\u0085'
  expect(render({ ...BASE, branch }, 80)!.text).toBe('maingnp.exex')
})

test('a branch made only of stripped characters falls back to the sha', () => {
  expect(render({ ...BASE, branch: '\u202E\u202D' }, 80)!.text).toBe('HEAD@abc1234')
})
