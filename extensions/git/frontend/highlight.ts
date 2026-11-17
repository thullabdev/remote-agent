type ShikiModule = typeof import('shiki')

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
}

let shikiPromise: Promise<ShikiModule | null> | null = null

function loadShiki(): Promise<ShikiModule | null> {
  if (shikiPromise === null) {
    shikiPromise = import('shiki').catch(() => null)
  }
  return shikiPromise
}

export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) {
    return 'text'
  }
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? 'text'
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function highlightLine(code: string, lang: string): Promise<string> {
  if (lang === 'text') {
    return escapeHtml(code)
  }
  try {
    const shiki = await loadShiki()
    if (shiki === null) {
      return escapeHtml(code)
    }
    return await shiki.codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' } })
  } catch {
    return escapeHtml(code)
  }
}
