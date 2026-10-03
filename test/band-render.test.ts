import { expect, test } from 'claude-code/testing'
import { BAND, boot, settle, setup } from './harness.ts'

test('draws branch and counts, and keeps other mods below', async ($, on) => {
  const { clock } = setup(on, 'dirty')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'main · ±3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own before the first refresh', async ($, on) => {
  setup(on, 'dirty')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own outside a repository', async ($, on) => {
  const { clock } = setup(on, 'not-a-repo')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /HEAD|main|±/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own when git is missing', async ($, on) => {
  const { clock } = setup(on, 'missing')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'repo-pulse' })).toBeUndefined()
  await ui.unmount()
})

test('shows the conflict badge in the warning colour', async ($, on) => {
  const { clock } = setup(on, 'rebase_conflict')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  const badge = await ui.find({ type: 'Text', text: '⚠ CONFLICT' })
  expect(badge).toBeDefined()
  expect(badge!.props.color).toBe('warning')
  await ui.unmount()
})

test('dims the band while git is slow, and undims after recovery', async ($, on) => {
  const { clock, world } = setup(on, 'dirty')
  await boot($, clock)
  world.scenario = 'slow'
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: 'main · ±3' }))!.props.dimColor).toBe(true)
  await ui.unmount()

  world.scenario = 'dirty'
  await clock.advance(121_000)
  await settle(clock)
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: 'main · ±3' }))!.props.dimColor).toBeUndefined()
  await ui.unmount()
})

test('a narrow band shortens the branch, not the counts', async ($, on) => {
  const { clock } = setup(on, 'ahead_behind')
  await boot($, clock)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 9 } })
  // Tail ' · ↑1 ↓2' is 8 columns, so the branch gets 1 column: '…'
  expect(await ui.find({ type: 'Text', text: '… · ↑1 ↓2' })).toBeDefined()
  await ui.unmount()
})

test('the desktop app gets the same row', async ($, on) => {
  const { clock } = setup(on, 'dirty')
  await boot($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'main · ±3' })).toBeDefined()
  await ui.unmount()
})

test('yields the band to a survey', async ($, on) => {
  const { clock } = setup(on, 'dirty')
  await boot($, clock)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'repo-pulse' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})
