// Renders compose.html (the laptop and phone frames around the two screenshots) to a transparent PNG.
// Env: WORK (folder with laptop.png and phone.png), CHROME (browser path).
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const work = process.env.WORK
const chrome = process.env.CHROME
if (!work || !chrome) {
  throw new Error('Set WORK and CHROME')
}

const here = dirname(fileURLToPath(import.meta.url))
// The page loads laptop.png and phone.png by relative path, so it is rendered from the work folder.
copyFileSync(join(here, 'compose.html'), join(work, 'compose.html'))

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 1040, deviceScaleFactor: 2 })
  await page.goto(`file://${join(work, 'compose.html')}`, { waitUntil: 'load' })
  // The frames default to a near-black warm gray that suits Gruvbox. Use PREVIEW_BEZEL for another theme.
  if (process.env.PREVIEW_BEZEL) {
    await page.addStyleTag({ content: `:root { --bezel: ${process.env.PREVIEW_BEZEL}; }` })
  }
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())))
  await page.screenshot({
    path: join(work, 'hero-raw.png'),
    omitBackground: true,
    clip: { x: 0, y: 0, width: 1300, height: 1040 },
  })
} finally {
  await browser.close()
}
console.log('compose: done')
