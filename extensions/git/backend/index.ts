import type { ExtensionApi } from '../../../src/extension-sdk/index.ts'
import { createGitRoutes } from './routes.ts'

export function onActivate(api: ExtensionApi) {
  const routes = createGitRoutes({})
  api.backend.registerHttpRoute('GET', '/repo', request => routes.repo(request))
  api.backend.registerHttpRoute('GET', '/status', request => routes.status(request))
  api.backend.registerHttpRoute('GET', '/log', request => routes.log(request))
  api.backend.registerHttpRoute('GET', '/commit-files', request => routes.commitFiles(request))
  api.backend.registerHttpRoute('GET', '/diff', request => routes.diff(request))
  api.backend.registerHttpRoute('POST', '/stage', request => routes.stage(request))
  api.backend.registerHttpRoute('POST', '/unstage', request => routes.unstage(request))
  api.backend.registerHttpRoute('POST', '/commit', request => routes.commit(request))
}
