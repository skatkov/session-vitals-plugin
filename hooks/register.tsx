import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meter, Vitals } from '../types'

type $ = EngineInterface

const PANE = 'vitals'

const emptyVitals = (sessionId: string): Vitals => ({
  sessionId,
  turns: 0,
  steps: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  tools: {},
  isPartial: false,
})

// Bump a shape tag whenever its type changes: values stored by an earlier version outlive a reload.
const vitals = atom({ plugin: 'session-vitals', key: 'vitals' } as const, emptyVitals(''), {
  shape: 'vitals-1',
})
const meter = atom({ plugin: 'session-vitals', key: 'meter' } as const, { window: 0 } as Meter, {
  shape: 'meter-1',
})

const totalTokens = (v: Vitals) =>
  v.tokens.input + v.tokens.output + v.tokens.cacheRead + v.tokens.cacheWrite

const exact = (n: number) => n.toLocaleString('en-US')

export const compact = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

type ToolRow = { label: string; count: number; depth: number }

export const toolRows = (tools: Record<string, number>): ToolRow[] => {
  const servers = new Map<string, Record<string, number>>()
  const rows: { label: string; count: number; children: ToolRow[] }[] = []

  for (const [name, count] of Object.entries(tools)) {
    const [prefix, server, ...rest] = name.split('__')
    if (prefix === 'mcp' && server && rest.length > 0) {
      const calls = servers.get(server) ?? {}
      calls[rest.join('__')] = count
      servers.set(server, calls)
    } else {
      rows.push({ label: name, count, children: [] })
    }
  }
  for (const [server, calls] of servers) {
    const children = Object.entries(calls)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, depth: 1 }))
    const count = children.reduce((sum, c) => sum + c.count, 0)
    rows.push({ label: `${server} (subtotal)`, count, children })
  }

  return rows
    .sort((a, b) => b.count - a.count)
    .flatMap(r => [{ label: r.label, count: r.count, depth: 0 }, ...r.children])
}

const contextText = (m: Meter, format: (n: number) => string) =>
  m.contextTokens === undefined
    ? '—'
    : `${format(m.contextTokens)}${m.contextPercent === undefined ? '' : ` (${m.contextPercent}%)`}`

// Empty until there is something to report: a fresh session adds nothing to the lane.
export const statusText = (v: Vitals, m: Meter) => {
  const approx = v.isPartial ? '~' : ''
  const parts: string[] = []

  if (v.turns > 0) parts.push(`${v.turns} ${v.turns === 1 ? 'turn' : 'turns'}`)
  if (v.steps > 0) parts.push(`${approx}${v.steps} ${v.steps === 1 ? 'step' : 'steps'}`)
  if (m.contextTokens !== undefined) parts.push(contextText(m, compact))

  return parts.join(' · ')
}

export const detailLines = (v: Vitals, m: Meter): string[] => {
  const approx = v.isPartial ? '~' : ''
  const toolTotal = Object.values(v.tools).reduce((sum, n) => sum + n, 0)

  return [
    `Turns: ${v.turns}`,
    `Steps: ${approx}${v.steps}`,
    `Total tokens: ${approx}${exact(totalTokens(v))}`,
    `  input: ${exact(v.tokens.input)}`,
    `  output: ${exact(v.tokens.output)}`,
    `  cache read: ${exact(v.tokens.cacheRead)}`,
    `  cache write: ${exact(v.tokens.cacheWrite)}`,
    `Context: ${contextText(m, exact)}${m.window ? ` of ${compact(m.window)}` : ''}`,
    `Cost: ${m.costUsd === undefined ? '—' : `$${m.costUsd.toFixed(2)}`}`,
    `Tool calls: ${toolTotal}`,
    ...toolRows(v.tools).map(r => `${'  '.repeat(r.depth + 1)}${r.label}: ${r.count}`),
  ]
}

// History before this process started (a resume) has no per-step usage, so it is marked partial.
const backfill = async ($: $, sessionId: string): Promise<Vitals> => {
  const v = emptyVitals(sessionId)
  const messages = await $.session.messages()
  v.turns = await $.session.turns()
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    v.steps += 1
    for (const use of m.toolUses) v.tools[use.tool] = (v.tools[use.tool] ?? 0) + 1
  }
  v.isPartial = v.steps > 0

  return v
}

const sync = async ($: $) => {
  const id = await $.session.id()
  if ((await read($, vitals)).sessionId === id) return
  const fresh = await backfill($, id)
  await update($, vitals, v => (v.sessionId === id ? v : fresh))
}

const bump = async ($: $, change: (v: Vitals) => Vitals) => {
  await sync($)
  await update($, vitals, change)
}

const measure = async ($: $) => {
  const usage = await $.session.usage()
  await update($, meter, () => ({
    window: usage.context.window,
    contextTokens: usage.context.tokens,
    contextPercent: usage.context.percent,
    costUsd: usage.cost?.usd,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'vitals', description: 'Show session vitals' })
    await $.command.register({
      name: 'vitals-refresh',
      description: 'Recount session vitals from the transcript',
    })
    await measure($)
    await sync($)
    void $.ui.open({ id: PANE, title: 'Vitals' })

    return next(e)
  })

  on('command.run', { command: 'vitals' }, async $ => {
    await sync($)
    await $.ui.open({ id: PANE, title: 'Vitals' })

    return { text: detailLines(await read($, vitals), await read($, meter)).join('\n') }
  })

  on('command.run', { command: 'vitals-refresh' }, async $ => {
    const fresh = await backfill($, await $.session.id())
    await update($, vitals, v => ({ ...fresh, tokens: v.tokens, isPartial: true }))
    await measure($)

    return { text: 'Vitals recounted from the transcript.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text !== '') {
      const turns = await $.session.turns()
      await bump($, v => ({ ...v, turns: Math.max(turns, v.turns + 1) }))
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    await bump($, v => ({
      ...v,
      steps: e.agentId === undefined ? v.steps + 1 : v.steps,
      tokens: usage
        ? {
            input: v.tokens.input + usage.input_tokens,
            output: v.tokens.output + usage.output_tokens,
            cacheRead: v.tokens.cacheRead + usage.cache_read_input_tokens,
            cacheWrite: v.tokens.cacheWrite + usage.cache_creation_input_tokens,
          }
        : v.tokens,
    }))

    return result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    await bump($, v => ({ ...v, tools: { ...v.tools, [tool]: (v.tools[tool] ?? 0) + 1 } }))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, meter, () => ({
      window: e.context.window,
      contextTokens: e.context.tokens,
      contextPercent: e.context.percent,
      costUsd: e.cost?.usd,
    }))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await update($, vitals, () => emptyVitals(''))
      await update($, meter, m => ({ window: m.window }))
    }

    return result
  })

  // The footer's right slot, the lane that carries the mode labels: one line, no lane of its own.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = statusText(await read($, vitals), await read($, meter))
    if (text === '') return next(e)

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lines = detailLines(await read($, vitals), await read($, meter))

    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Text dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    )
  })
}
