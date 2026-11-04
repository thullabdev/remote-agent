import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

export type Project = { label: string; cwd: string }

type Options = { home: string; projects: string[] }

function expandHome(path: string, home: string): string {
  if (path === '~') {
    return home
  }
  if (path.startsWith('~/')) {
    return `${home}${path.slice(1)}`
  }
  return path
}

/** Absolute, symlink-free, no trailing slash; null for relative or missing paths. */
async function normalise(path: string, home: string): Promise<string | null> {
  const expanded = expandHome(path.trim(), home)
  if (!isAbsolute(expanded)) {
    return null
  }
  try {
    return await realpath(resolve(expanded))
  } catch {
    return null
  }
}

/** The folders listed in REMOTE_AGENT_PROJECTS: the only places a Spawned Session may start. */
export class TrustedFolders {
  constructor(private readonly options: Options) {}

  async isTrusted(path: string): Promise<string | null> {
    const cwd = await normalise(path, this.options.home)
    if (cwd === null) {
      return null
    }
    return (await this.listed()).has(cwd) ? cwd : null
  }

  async configuredProjects(): Promise<Project[]> {
    const projects: Project[] = []
    for (const entry of this.options.projects) {
      const cwd = await normalise(entry, this.options.home)
      if (cwd !== null) {
        projects.push({ label: basename(cwd), cwd })
      }
    }
    return projects
  }

  /** Entries that are relative or do not exist, so they are left out. */
  async unusableProjects(): Promise<string[]> {
    const unusable: string[] = []
    for (const entry of this.options.projects) {
      if ((await normalise(entry, this.options.home)) === null) {
        unusable.push(entry)
      }
    }
    return unusable
  }

  /** Resolved fresh every time: a folder created since the Bridge started counts immediately. */
  private async listed(): Promise<Set<string>> {
    return new Set((await this.configuredProjects()).map(project => project.cwd))
  }
}
