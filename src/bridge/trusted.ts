import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

export type Project = { label: string; cwd: string }

type Options = { home: string; configPath: string }
type ClaudeProject = { hasTrustDialogAccepted?: unknown }
type ClaudeConfig = { projects?: Record<string, ClaudeProject> }

const ENOENT = 'ENOENT'

export class TrustedFoldersUnavailable extends Error {}

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
    const path = await realpath(resolve(expanded))
    return (await stat(path)).isDirectory() ? path : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === ENOENT || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return null
    }
    throw error
  }
}

/** Folders Claude Code has explicitly marked as trusted in its user config. */
export class TrustedFolders {
  constructor(private readonly options: Options) {}

  async isTrusted(path: string): Promise<string | null> {
    const cwd = await normalise(path, this.options.home)
    if (cwd === null) {
      return null
    }
    return (await this.listed()).includes(cwd) ? cwd : null
  }

  async configuredProjects(): Promise<Project[]> {
    const entries = await this.listed()
    const projects: Project[] = []
    for (const cwd of entries) {
      const path = await normalise(cwd, this.options.home)
      if (path !== null) {
        projects.push({ label: basename(path), cwd: path })
      }
    }
    return projects
  }

  private async listed(): Promise<string[]> {
    let raw: string
    try {
      raw = await readFile(this.options.configPath, 'utf8')
    } catch (error) {
      throw new TrustedFoldersUnavailable(
        `Cannot read Claude Code config at ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    let config: unknown
    try {
      config = JSON.parse(raw)
    } catch (error) {
      throw new TrustedFoldersUnavailable(
        `Cannot parse Claude Code config at ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new TrustedFoldersUnavailable(`Claude Code config at ${this.options.configPath} has an invalid shape`)
    }
    const projects = (config as ClaudeConfig).projects
    if (projects === undefined) {
      return []
    }
    if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) {
      throw new TrustedFoldersUnavailable(`Claude Code config at ${this.options.configPath} has an invalid projects value`)
    }
    return Object.entries(projects)
      .filter((entry): entry is [string, ClaudeProject] =>
        entry[1] !== null && typeof entry[1] === 'object' && entry[1].hasTrustDialogAccepted === true,
      )
      .map(([cwd]) => cwd)
  }
}
