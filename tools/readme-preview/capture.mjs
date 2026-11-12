// Takes the laptop and phone screenshots of the throwaway Bridge's web UI.
// Env: BASE_URL (the proxy, which adds the Tailscale identity), WORK (output folder), CHROME (browser path).
import puppeteer from 'puppeteer-core'

const baseUrl = process.env.BASE_URL
const work = process.env.WORK
const chrome = process.env.CHROME
if (!baseUrl || !work || !chrome) {
  throw new Error('Set BASE_URL, WORK and CHROME')
}

// Gruvbox in dark mode by default. Set PREVIEW_PALETTE and PREVIEW_MODE (light or dark) to use another theme; the palette
// ids are in src/ui/themes.ts, and the key and shape of the preferences come from src/ui/preferences.ts.
const PREFERENCES = {
  theme: process.env.PREVIEW_MODE ?? 'dark',
  palette: process.env.PREVIEW_PALETTE ?? 'gruvbox',
  accent: 'ink',
  glow: 'soft',
  density: 'comfortable',
  font: 'medium',
  enter: 'newline',
  codeWrap: 'scroll',
  generalView: 'dashboard',
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function openPage(browser, viewport, userAgent) {
  const page = await browser.newPage()
  if (userAgent) {
    await page.setUserAgent(userAgent)
  }
  await page.setViewport(viewport)
  await page.evaluateOnNewDocument(preferences => {
    try {
      localStorage.setItem('remote-agent.preferences.v1', JSON.stringify(preferences))
    } catch {}
  }, PREFERENCES)
  await page.goto(baseUrl, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('Needs you'), { timeout: 20000 })
  return page
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
try {
  const laptop = await openPage(browser, { width: 1440, height: 900, deviceScaleFactor: 2 })
  const general = await laptop.$$("xpath/.//span[normalize-space(.)='General']")
  if (general.length > 0) {
    await general[0].click()
  }
  await laptop.waitForFunction(() => document.body.innerText.includes('Mission control'), { timeout: 15000 })
  await sleep(3000)
  await laptop.screenshot({ path: `${work}/laptop.png` })
  await laptop.close()

  const phone = await openPage(
    browser,
    { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  )
  await sleep(2000)
  await phone.screenshot({ path: `${work}/phone.png` })
  await phone.close()
} finally {
  await browser.close()
}
console.log('capture: done')
