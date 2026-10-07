import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TrustedFolders, TrustedFoldersUnavailable } from '../../src/bridge/trusted.ts'

let home: string
let configPath: string

async function trust(entries: Record<string, boolean>): Promise<void> {
  const projects = Object.fromEntries(Object.entries(entries).map(([path, accepted]) => [path, { hasTrustDialogAccepted: accepted }]))
  await writeFile(configPath, JSON.stringify({ projects }))
}

function folders(projects: string[] = []): TrustedFolders {
  return new TrustedFolders({ configPath, home, projects })
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-trusted-`))
  configPath = `${home}/.claude.json`
  await mkdir(`${home}/Sites/api/src`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  await trust({ [`${home}/Sites/api`]: true, [`${home}/Sites/My Projects/app/`]: true, [`${home}/Sites/secret`]: false })
})

test('exact trusted folders are accepted, with ~ and a trailing slash', async () => {
  expect(await folders().isTrusted(`${home}/Sites/api`)).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/api/')).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/My Projects/app')).toBe(`${home}/Sites/My Projects/app`)
})

test('subfolders, untrusted, missing, relative and ~user paths are refused', async () => {
  expect(await folders().isTrusted('~/Sites/api/src')).toBeNull()
  expect(await folders().isTrusted('~/Sites/secret')).toBeNull()
  expect(await folders().isTrusted('~/Sites/nope')).toBeNull()
  expect(await folders().isTrusted('Sites/api')).toBeNull()
  expect(await folders().isTrusted('~root/Sites/api')).toBeNull()
})

test('a symlink to a trusted folder resolves to it', async () => {
  await symlink(`${home}/Sites/api`, `${home}/api-link`)
  expect(await folders().isTrusted('~/api-link')).toBe(`${home}/Sites/api`)
})

test('configured projects keep their order and drop untrusted entries', async () => {
  const trusted = folders(['~/Sites/My Projects/app', '~/Sites/secret', '~/Sites/api'])
  expect(await trusted.configuredProjects()).toEqual([
    { label: 'app', cwd: `${home}/Sites/My Projects/app` },
    { label: 'api', cwd: `${home}/Sites/api` },
  ])
  expect(await trusted.untrustedProjects()).toEqual(['~/Sites/secret'])
})

test('an unreadable or invalid config is reported', async () => {
  await writeFile(configPath, '{not json')
  await expect(folders().isTrusted('~/Sites/api')).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
  const missing = new TrustedFolders({ configPath: `${home}/none.json`, home, projects: [] })
  await expect(missing.isTrusted('~/Sites/api')).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
})

test('a config without projects trusts nothing', async () => {
  await writeFile(configPath, '{}')
  expect(await folders().isTrusted('~/Sites/api')).toBeNull()
})
