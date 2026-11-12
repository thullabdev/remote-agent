// Takes the screenshots of the throwaway Bridge's web UI: the dashboard and Session list for the README hero, and the
// chat views for the gallery.
// Env: BASE_URL (the proxy, which adds the Tailscale identity), WORK (output folder), CHROME (browser path),
//      PREVIEW_PALETTE and PREVIEW_MODE (the theme).
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

const LAPTOP = { width: 1440, height: 900, deviceScaleFactor: 2 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const PHONE_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

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

/** Taps the smallest element that holds the text, so the click reaches the row it belongs to. */
async function tap(page, text) {
  const handle = await page.evaluateHandle(needle => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], li, div, span, p')].filter(
      element => element.textContent.includes(needle),
    )
    candidates.sort((a, b) => a.textContent.length - b.textContent.length)
    return candidates[0] ?? null
  }, text)
  const element = handle.asElement()
  if (element === null) {
    throw new Error(`Nothing on the page holds the text "${text}"`)
  }
  await element.click()
}

async function waitForText(page, text) {
  await page.waitForFunction(needle => document.body.innerText.includes(needle), { timeout: 20000 }, text)
}

/** Scrolls the message feed: to the end, or so the smallest element matching the pattern sits near the top. */
async function scrollFeed(page, pattern) {
  await page.evaluate(source => {
    const feed = document.querySelector('.chat-message-feed')
    if (feed === null) {
      return
    }
    if (source === undefined) {
      feed.scrollTop = feed.scrollHeight
      return
    }
    const matcher = new RegExp(source)
    const matches = [...feed.querySelectorAll('*')].filter(element => matcher.test(element.textContent))
    matches.sort((a, b) => a.textContent.length - b.textContent.length)
    const target = matches[0]
    if (target !== undefined) {
      feed.scrollTop += target.getBoundingClientRect().top - feed.getBoundingClientRect().top - 64
    }
  }, pattern)
  await sleep(500)
}

/** The Edit step is two taps deep: the "Agent activity" group, then its Edit row, which shows as a diff. */
async function expandEdit(page) {
  await tap(page, 'Edit')
  await sleep(800)
  await tap(page, '2.0s')
  await waitForText(page, 'getSession')
}

/** Fonts are bundled with the app; wait for them so the shot never shows a fallback font. */
async function settle(page, ms = 1500) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(ms)
}

async function shoot(page, name) {
  await settle(page)
  await page.screenshot({ path: `${work}/${name}.png` })
  console.log(`capture: ${name}`)
  await page.close()
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
try {
  // Hero: the laptop shows the Mission control dashboard, the phone shows the Session list.
  {
    const page = await openPage(browser, LAPTOP)
    await tap(page, 'General')
    await waitForText(page, 'Mission control')
    await sleep(2500)
    await shoot(page, 'laptop')
  }
  await shoot(await openPage(browser, PHONE, PHONE_AGENT), 'phone')

  // Gallery: a chat with agent activity and an Edit diff, ending at a permission request.
  {
    const page = await openPage(browser, LAPTOP)
    await tap(page, 'Fix login redirect')
    await waitForText(page, 'Allow')
    await expandEdit(page)
    await scrollFeed(page, 'Agent activityEdit')
    await shoot(page, 'laptop-chat')
  }
  {
    const page = await openPage(browser, PHONE, PHONE_AGENT)
    await tap(page, 'Fix login redirect')
    await waitForText(page, 'Allow')
    await expandEdit(page)
    await scrollFeed(page, 'Agent activityEdit')
    await shoot(page, 'phone-activity')
  }
  // Gallery: a chat that ends in a question with options.
  {
    const page = await openPage(browser, PHONE, PHONE_AGENT)
    await tap(page, 'Choose a cache strategy')
    await waitForText(page, 'In-memory LRU')
    await sleep(1000)
    await scrollFeed(page)
    await sleep(500)
    await scrollFeed(page)
    await shoot(page, 'phone-question')
  }
  // Gallery: the dashboard on a phone.
  {
    const page = await openPage(browser, PHONE, PHONE_AGENT)
    await tap(page, 'General')
    await waitForText(page, 'Mission control')
    await sleep(2500)
    await shoot(page, 'phone-dashboard')
  }
} finally {
  await browser.close()
}
console.log('capture: done')
