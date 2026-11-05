export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Vitals = {
  sessionId: string
  turns: number
  steps: number
  tokens: Tokens
  tools: Record<string, number>
  isPartial: boolean
}

export type Meter = {
  window: number
  contextTokens?: number
  contextPercent?: number
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-vitals': { vitals: Shaped<Vitals>; meter: Shaped<Meter> }
  }
}
