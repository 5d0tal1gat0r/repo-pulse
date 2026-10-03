import { expect, test } from 'claude-code/testing'

test('the module loads and passes tool calls through', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out).toEqual({ result: 'ran' })
})
