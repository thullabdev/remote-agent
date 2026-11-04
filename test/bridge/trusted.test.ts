import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TrustedFolders } from '../../src/bridge/trusted.ts'

let home: string

function folders(projects: string[]): TrustedFolders {
  return new TrustedFolders({ home, projects })
}

const listed = ['~/Sites/api', '~/Sites/My Projects/app/']

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-trusted-`))
  await mkdir(`${home}/Sites/api/src`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
})

test('listed folders are accepted, with ~, an absolute path and a trailing slash', async () => {
  expect(await folders(listed).isTrusted(`${home}/Sites/api`)).toBe(`${home}/Sites/api`)
  expect(await folders(listed).isTrusted('~/Sites/api/')).toBe(`${home}/Sites/api`)
  expect(await folders(listed).isTrusted('~/Sites/My Projects/app')).toBe(`${home}/Sites/My Projects/app`)
})

test('subfolders, unlisted, missing, relative and ~user paths are refused', async () => {
  expect(await folders(listed).isTrusted('~/Sites/api/src')).toBeNull()
  expect(await folders(listed).isTrusted('~/Sites/secret')).toBeNull()
  expect(await folders(listed).isTrusted('~/Sites/nope')).toBeNull()
  expect(await folders(listed).isTrusted('Sites/api')).toBeNull()
  expect(await folders(listed).isTrusted('~root/Sites/api')).toBeNull()
})

test('a symlink to a listed folder resolves to it', async () => {
  await symlink(`${home}/Sites/api`, `${home}/api-link`)
  expect(await folders(listed).isTrusted('~/api-link')).toBe(`${home}/Sites/api`)
})

test('nothing is trusted when no project is listed', async () => {
  expect(await folders([]).isTrusted('~/Sites/api')).toBeNull()
})

test('configured projects keep their order and drop unusable entries', async () => {
  const trusted = folders(['~/Sites/My Projects/app', '~/Sites/nope', 'relative/dir', '~/Sites/api'])
  expect(await trusted.configuredProjects()).toEqual([
    { label: 'app', cwd: `${home}/Sites/My Projects/app` },
    { label: 'api', cwd: `${home}/Sites/api` },
  ])
  expect(await trusted.unusableProjects()).toEqual(['~/Sites/nope', 'relative/dir'])
})
