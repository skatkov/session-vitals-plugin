import { expect, test } from 'claude-code/testing'

import { compact, toolRows } from '../hooks/register'

const PANE = {
  plugin: 'session-vitals',
  component: 'Pane',
  requestId: 'vitals',
  props: {
    title: 'Vitals',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('compact abbreviates token counts', () => {
  expect(compact(950)).toBe('950')
  expect(compact(24_300)).toBe('24K')
  expect(compact(1_500_000)).toBe('1.5M')
  expect(compact(2_000_000)).toBe('2M')
})

test('MCP tools are grouped per server, sorted by count', () => {
  const rows = toolRows({ Read: 3, mcp__rubydex__get_declaration: 6, mcp__rubydex__get_descendants: 4, Bash: 1 })
  expect(rows.map(r => `${r.depth}:${r.label}:${r.count}`)).toEqual([
    '0:rubydex (subtotal):10',
    '1:get_declaration:6',
    '1:get_descendants:4',
    '0:Read:3',
    '0:Bash:1',
  ])
})

test('the pane counts tool calls, on every surface', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 0.43 } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Tool calls/ }))?.text).toBe('Tool calls: 2')
    expect((await ui.find({ type: 'Text', text: /Bash/ }))?.text).toBe('  Bash: 2')
    expect((await ui.find({ type: 'Text', text: /^Context/ }))?.text).toBe('Context: 24,000 (12%) of 200K')
    expect((await ui.find({ type: 'Text', text: /^Cost/ }))?.text).toBe('Cost: $0.43')
    await ui.unmount()
  }
})

test('the footer line rides the mode lane, after the modes already there', async ($, on) => {
  let modes: readonly string[] | undefined

  on('ui.render', (_, e) => {
    if (e.component === 'SessionMode') modes = e.props.modes

    return { type: 'engine', ref: 0 }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: 3 }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [], cost: { usd: 0.43 } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'session-vitals',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })

  expect(modes).toEqual(['auto mode on', '3 turns · 24K (12%)'])
  await ui.unmount()
})

test('a session with nothing to report leaves the mode lane alone', async ($, on) => {
  let modes: readonly string[] | undefined

  on('ui.render', (_, e) => {
    if (e.component === 'SessionMode') modes = e.props.modes

    return { type: 'engine', ref: 0 }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'session-vitals',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['auto mode on'] },
  })

  expect(modes).toEqual(['auto mode on'])
  await ui.unmount()
})
