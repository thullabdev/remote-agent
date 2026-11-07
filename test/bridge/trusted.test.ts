import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TrustedFolders, TrustedFoldersUnavailable } from '../../src/bridge/trusted.ts'

let home: string
let configPath: string

function folders(): TrustedFolders {
  return new TrustedFolders({ home, configPath, projects: [] })
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-trusted-`))
  configPath = `${home}/.claude.json`
  await mkdir(`${home}/Sites/api/src`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  await mkdir(`${home}/Sites/other`, { recursive: true })
  await writeFile(configPath, JSON.stringify({
    projects: {
      [`${home}/Sites/api`]: { hasTrustDialogAccepted: true },
      [`${home}/Sites/My Projects/app`]: { hasTrustDialogAccepted: true },
      [`${home}/Sites/secret`]: { hasTrustDialogAccepted: false },
    },
  }))
})

test('Claude-trusted folders are accepted, with ~ and a trailing slash', async () => {
  expect(await folders().isTrusted(`${home}/Sites/api`)).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/api/')).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/My Projects/app')).toBe(`${home}/Sites/My Projects/app`)
})

test('subfolders, untrusted, missing, relative and ~user paths are refused', async () => {
  expect(await folders().isTrusted('~/Sites/api/src')).toBeNull()
  expect(await folders().isTrusted('~/Sites/other')).toBeNull()
  expect(await folders().isTrusted('~/Sites/nope')).toBeNull()
  expect(await folders().isTrusted('Sites/api')).toBeNull()
  expect(await folders().isTrusted('~root/Sites/api')).toBeNull()
})

test('a project entry that is not a directory is not offered', async () => {
  const file = `${home}/Sites/file`
  await writeFile(file, '')
  await writeFile(configPath, JSON.stringify({
    projects: { [file]: { hasTrustDialogAccepted: true } },
  }))
  expect(await folders().configuredProjects()).toEqual([])
  expect(await folders().isTrusted(file)).toBeNull()
})

test('a symlink to a trusted folder resolves to it', async () => {
  await symlink(`${home}/Sites/api`, `${home}/api-link`)
  expect(await folders().isTrusted('~/api-link')).toBe(`${home}/Sites/api`)
})

test('every Claude Code project key is listed, whether or not the trust dialog was accepted', async () => {
  expect(await folders().configuredProjects()).toEqual([
    { label: 'api', cwd: `${home}/Sites/api` },
    { label: 'app', cwd: `${home}/Sites/My Projects/app` },
    { label: 'secret', cwd: `${home}/Sites/secret` },
  ])
  expect(await folders().isTrusted('~/Sites/secret')).toBe(`${home}/Sites/secret`)
})

test('REMOTE_AGENT_PROJECTS entries are trusted too, with ~, and duplicates are listed once', async () => {
  const env = new TrustedFolders({ home, configPath, projects: ['~/Sites/other', '~/Sites/api/', `${home}/Sites/nope`] })
  expect(await env.isTrusted('~/Sites/other')).toBe(`${home}/Sites/other`)
  expect(await env.isTrusted('~/Sites/api')).toBe(`${home}/Sites/api`)
  expect(await env.isTrusted('~/Sites/nope')).toBeNull()
  expect(await env.configuredProjects()).toEqual([
    { label: 'other', cwd: `${home}/Sites/other` },
    { label: 'api', cwd: `${home}/Sites/api` },
    { label: 'app', cwd: `${home}/Sites/My Projects/app` },
    { label: 'secret', cwd: `${home}/Sites/secret` },
  ])
})

test('a REMOTE_AGENT_PROJECTS entry still needs the config to be readable', async () => {
  const env = new TrustedFolders({ home, configPath: `${home}/missing.json`, projects: [`${home}/Sites/other`] })
  await expect(env.isTrusted(`${home}/Sites/other`)).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
})

test('missing or malformed Claude config fails explicitly', async () => {
  const missing = new TrustedFolders({ home, configPath: `${home}/missing.json`, projects: [] })
  await expect(missing.configuredProjects()).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
  await writeFile(configPath, '{')
  await expect(folders().configuredProjects()).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
})
