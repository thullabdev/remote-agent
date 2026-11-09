/** What the Bridge asks an agent to start. Ids are already checked by the Launcher. */
export type LaunchSpec = {
  sessionId: string
  cwd: string
  model?: string | null
  resumeFrom?: string
  fork?: boolean
  /** Extra folders the Session may read without asking, such as the upload library. */
  addDirs?: string[]
}

/**
 * The agent a Spawned Session runs. The Launcher wraps the returned argv in tmux and systemd-run;
 * the adapter only decides which program to run and how to pass it the session identity and model.
 */
export interface AgentAdapter {
  /** Stable name, e.g. "claude-code". Shown in logs and used to pick an adapter. */
  readonly name: string
  /** The argv that starts the agent for this spec. Pure: no I/O. */
  launchArgv(spec: LaunchSpec): string[]
}

/** Claude Code: `claude --session-id` for new sessions, `--resume` (optionally `--fork-session`) for existing transcripts. */
export const claudeCodeAdapter: AgentAdapter = {
  name: 'claude-code',
  launchArgv(spec) {
    // Forks use a new id; resuming in place keeps the original Claude session id and transcript.
    const identity =
      spec.resumeFrom === undefined
        ? ['--session-id', spec.sessionId]
        : spec.fork === false
          ? ['--resume', spec.resumeFrom]
          : ['--resume', spec.resumeFrom, '--fork-session', '--session-id', spec.sessionId]
    const dirs = (spec.addDirs ?? []).flatMap(dir => ['--add-dir', dir])
    return ['claude', ...identity, ...(spec.model == null ? [] : ['--model', spec.model]), ...dirs]
  },
}
