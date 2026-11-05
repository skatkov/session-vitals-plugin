import { Plugin } from "@opencode/plugin"

// Metrics are read by the terminal client. No server hooks or extra model calls.
export default Plugin.define({
  id: "opencode-session-vitals.server",
  setup() {},
})
