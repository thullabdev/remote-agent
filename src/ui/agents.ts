// Agents this UI can show a name for. Add an entry when another agent is supported.
export type AgentId = 'claude-code'

export type AgentInfo = {
  name: string
}

export const DEFAULT_AGENT_ID: AgentId = 'claude-code'

const AGENTS: Record<AgentId, AgentInfo> = {
  'claude-code': { name: 'Claude Code' },
}

// Unknown or missing ids fall back to the default agent.
export function agentInfo(agentId: string | null | undefined): AgentInfo {
  return agentId !== null && agentId !== undefined && agentId in AGENTS
    ? AGENTS[agentId as AgentId]
    : AGENTS[DEFAULT_AGENT_ID]
}
