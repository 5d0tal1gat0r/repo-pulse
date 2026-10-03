import { expect, test } from 'claude-code/testing'
import { NOT_A_REPO } from '../hooks/git-state.js'
import { diff } from '../hooks/risk.js'

const CLEAN = { ...NOT_A_REPO, isRepo: true, branch: 'main', sha: 'abc1234', hasUpstream: true }
const CONFLICT = { ...CLEAN, conflicts: 1, dirty: 1, op: 'merge' as const }
const REBASING = { ...CLEAN, branch: null, conflicts: 1, dirty: 1, op: 'rebase' as const }
const DETACHED = { ...CLEAN, branch: null }

test('first refresh in a clean repository: no toast', () => {
  expect(diff(null, CLEAN)).toEqual([])
})

test('first refresh mid-rebase: conflict and rebase, no detached toast', () => {
  expect(diff(null, REBASING)).toEqual(['Merge conflict in 1 file(s)', 'Rebase in progress'])
})

test('first refresh on a detached HEAD', () => {
  expect(diff(null, DETACHED)).toEqual(['Detached HEAD at abc1234'])
})

test('a merge that conflicts', () => {
  expect(diff(CLEAN, CONFLICT)).toEqual(['Merge conflict in 1 file(s)', 'Merge in progress'])
})

test('a merge in progress without conflicts', () => {
  expect(diff(CLEAN, { ...CLEAN, op: 'merge' })).toEqual(['Merge in progress'])
})

test('a state that persists does not toast again', () => {
  expect(diff(CONFLICT, CONFLICT)).toEqual([])
  expect(diff(REBASING, REBASING)).toEqual([])
  expect(diff(DETACHED, DETACHED)).toEqual([])
})

test('a changing conflict count does not toast again', () => {
  expect(diff(CONFLICT, { ...CONFLICT, conflicts: 3 })).toEqual([])
})

test('a conflict that is resolved and reappears toasts again', () => {
  const resolved = { ...CONFLICT, conflicts: 0 }
  expect(diff(CONFLICT, resolved)).toEqual([])
  expect(diff(resolved, { ...CONFLICT, conflicts: 2 })).toEqual(['Merge conflict in 2 file(s)'])
})

test('finishing a rebase back onto a branch is quiet', () => {
  expect(diff(REBASING, CLEAN)).toEqual([])
})

test('nothing outside a repository', () => {
  expect(diff(CLEAN, NOT_A_REPO)).toEqual([])
  expect(diff(null, NOT_A_REPO)).toEqual([])
})

test('moving from a non-repository into a merge counts like a first refresh', () => {
  expect(diff(NOT_A_REPO, { ...CLEAN, op: 'merge' })).toEqual(['Merge in progress'])
})

test('detached with no sha', () => {
  expect(diff(CLEAN, { ...DETACHED, sha: null })).toEqual(['Detached HEAD at unknown commit'])
})
