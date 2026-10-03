import { expect, test } from 'claude-code/testing'
import { boot, settle, setup } from './harness.ts'

test('first refresh runs 500 ms after session start', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle(clock)
  expect(world.statusCalls).toBe(0)
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(1)
})

test('tool.call results pass through unchanged', async ($, on) => {
  setup(on, 'clean')
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out).toEqual({ result: 'ran' })
})

test('a burst of tool calls makes one refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Edit', file_path: 'a.txt', old_string: 'a', new_string: 'b' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
})

test('read-only tools do not trigger a refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await $.tool.call({ tool: 'Read', file_path: 'a.txt' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before)
})

test('prompt.submit and turn.complete each schedule a refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await $.prompt.submit({ text: 'hi' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, usage: null })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 2)
})

test('the 30 s poll catches changes made outside Claude', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await clock.advance(30_500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
})

test('refreshes never overlap; a request during one runs once after it', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  world.delayMs = 2000
  await boot($, clock)                       // t=500: refresh 1 starts, git takes 2 s
  await $.tool.call({ tool: 'Bash', command: 'touch x' })
  await clock.advance(500)                   // t=1000: refresh 2 requested while 1 runs
  await settle(clock)
  expect(world.statusCalls).toBe(1)
  await clock.advance(2000)                  // t=3000: refresh 1 done, the rerun starts
  await settle(clock)
  expect(world.statusCalls).toBe(2)
  await clock.advance(2000)
  await settle(clock)
  expect(world.maxActive).toBe(1)
})

test('a toast fires once when a conflict appears', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  expect(world.toasts).toEqual([])
  world.scenario = 'merge_conflict'
  await $.tool.call({ tool: 'Bash', command: 'git merge side' })
  await clock.advance(500)
  await settle(clock)
  expect(world.toasts).toEqual(['Merge conflict in 1 file(s)', 'Merge in progress'])
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await clock.advance(500)
  await settle(clock)
  expect(world.toasts.length).toBe(2)
})

test('starting mid-rebase toasts once', async ($, on) => {
  const { clock, world } = setup(on, 'rebase_conflict')
  await boot($, clock)
  expect(world.toasts).toEqual(['Merge conflict in 1 file(s)', 'Rebase in progress'])
})

test('outside a repository there are no toasts and no logs', async ($, on) => {
  const { clock, world } = setup(on, 'not-a-repo')
  await boot($, clock)
  expect(world.toasts).toEqual([])
  expect(world.logs).toEqual([])
})

test('missing git logs once per session', async ($, on) => {
  const { clock, world } = setup(on, 'missing')
  await boot($, clock)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  expect(world.logs.length).toBe(1)
  expect(world.toasts).toEqual([])
})

test('slow git backs the poll off to 120 s and recovers', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  world.scenario = 'slow'
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  const afterSlow = world.statusCalls
  await clock.advance(60_000)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow)       // no 30 s poll while slow
  world.scenario = 'clean'
  await clock.advance(61_000)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow + 1)   // the 120 s poll, which now succeeds
  await clock.advance(30_500)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow + 2)   // back to 30 s
})
