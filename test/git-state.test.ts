import { expect, test } from 'claude-code/testing'
import { NOT_A_REPO, parse, sameState } from '../hooks/git-state.js'
import { fixtures } from './fixtures.ts'

const NO_MARKERS = { mergeHead: false, rebaseMerge: false, rebaseApply: false }
const fx = (name: string) => parse(fixtures[name].status, fixtures[name].markers)

test('clean repository with upstream', () => {
  const s = fx('clean')
  expect(s).toMatchObject({ isRepo: true, branch: 'main', dirty: 0, hasUpstream: true, ahead: 0, behind: 0, conflicts: 0, op: null })
  expect(s.sha).toMatch(/^[0-9a-f]{7}$/)
})

test('staged, unstaged and untracked entries all count as dirty', () => {
  expect(fx('dirty').dirty).toBe(3)
  expect(fx('untracked').dirty).toBe(1)
  expect(fx('rename').dirty).toBe(1)
})

test('ahead and behind come from branch.ab', () => {
  expect(fx('ahead_behind')).toMatchObject({ hasUpstream: true, ahead: 1, behind: 2 })
})

test('a branch with no upstream', () => {
  expect(fx('no_upstream')).toMatchObject({ branch: 'feature', hasUpstream: false, ahead: 0, behind: 0 })
})

test('detached HEAD has no branch but keeps the sha', () => {
  const s = fx('detached')
  expect(s.branch).toBe(null)
  expect(s.sha).toMatch(/^[0-9a-f]{7}$/)
})

test('a repository with no commits has no sha', () => {
  expect(fx('initial')).toMatchObject({ isRepo: true, branch: 'main', sha: null, hasUpstream: false })
})

test('merge conflict', () => {
  expect(fx('merge_conflict')).toMatchObject({ branch: 'main', conflicts: 1, dirty: 1, op: 'merge' })
})

test('rebase conflict is detached with op rebase', () => {
  expect(fx('rebase_conflict')).toMatchObject({ branch: null, conflicts: 1, op: 'rebase' })
})

test('rebase-apply alone means rebase', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', { ...NO_MARKERS, rebaseApply: true })
  expect(s.op).toBe('rebase')
})

test('rebase wins over a stale MERGE_HEAD', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', { mergeHead: true, rebaseMerge: true, rebaseApply: false })
  expect(s.op).toBe('rebase')
})

test('upstream deleted on the remote: no branch.ab line', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head main\n# branch.upstream origin/gone\n', NO_MARKERS)
  expect(s).toMatchObject({ hasUpstream: true, ahead: 0, behind: 0 })
})

test('quoted paths with spaces count as dirty', () => {
  const out = '# branch.oid 0123456789abcdef\n# branch.head main\n' +
    '1 .M N... 100644 100644 100644 0123 0123 "a b.txt"\n' +
    '? "c \\"d\\".txt"\n'
  expect(parse(out, NO_MARKERS).dirty).toBe(2)
})

test('ignored entries and other header lines are skipped', () => {
  const out = '# branch.oid 0123456789abcdef\n# branch.head main\n# stash 2\n! build/\n'
  expect(parse(out, NO_MARKERS).dirty).toBe(0)
})

test('unrecognised output throws', () => {
  expect(() => parse('fatal: something\n', NO_MARKERS)).toThrow()
  expect(() => parse('# branch.oid 0123456789abcdef\n', NO_MARKERS)).toThrow()
  expect(() => parse('# branch.oid 0123\n# branch.head main\n# branch.ab nonsense\n', NO_MARKERS)).toThrow()
})

test('NOT_A_REPO is an empty, non-repo state', () => {
  expect(NOT_A_REPO).toMatchObject({ isRepo: false, branch: null, sha: null, dirty: 0, conflicts: 0, op: null })
})

test('sameState compares every field', () => {
  expect(sameState(fx('clean'), fx('clean'))).toBe(true)
  expect(sameState(fx('clean'), fx('dirty'))).toBe(false)
  expect(sameState(NOT_A_REPO, fx('clean'))).toBe(false)
})
