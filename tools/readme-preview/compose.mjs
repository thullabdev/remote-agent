// Renders the device-framed images to transparent PNGs: the README hero (compose.html) and the gallery pictures
// (gallery.html with one laptop or phone each).
// Env: WORK (folder with the screenshots), CHROME (browser path), PREVIEW_BEZEL (frame color, optional).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const work = process.env.WORK
const chrome = process.env.CHROME
if (!work || !chrome) {
  throw new Error('Set WORK and CHROME')
}

const here = dirname(fileURLToPath(import.meta.url))

const laptopBody = image => `<div class="stage laptop-stage"><div class="laptop"><div class="lid"><img src="${image}" alt=""></div><div class="base"></div></div></div>`
const phoneBody = image =>
  `<div class="stage phone-stage"><div class="phone"><div class="screen"><img src="${image}" alt=""></div><div class="notch"></div></div></div>`

// Each scene becomes one HTML file in the work folder, because the pages load the screenshots by relative path.
const gallery = readFileSync(join(here, 'gallery.html'), 'utf8')
const scenes = [
  { page: 'compose.html', out: 'hero-raw.png', width: 1300, height: 1040 },
  { page: 'gallery-chat.html', html: gallery.replace('{{BODY}}', laptopBody('laptop-chat.png')), out: 'gallery-chat-raw.png', width: 1160, height: 740 },
  { page: 'gallery-activity.html', html: gallery.replace('{{BODY}}', phoneBody('phone-activity.png')), out: 'gallery-activity-raw.png', width: 340, height: 640 },
  { page: 'gallery-question.html', html: gallery.replace('{{BODY}}', phoneBody('phone-question.png')), out: 'gallery-question-raw.png', width: 340, height: 640 },
  { page: 'gallery-dashboard.html', html: gallery.replace('{{BODY}}', phoneBody('phone-dashboard.png')), out: 'gallery-dashboard-raw.png', width: 340, height: 640 },
]

for (const scene of scenes) {
  if (scene.html === undefined) {
    copyFileSync(join(here, scene.page), join(work, scene.page))
  } else {
    writeFileSync(join(work, scene.page), scene.html)
  }
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
})
try {
  for (const scene of scenes) {
    const page = await browser.newPage()
    await page.setViewport({ width: scene.width, height: scene.height, deviceScaleFactor: 2 })
    await page.goto(`file://${join(work, scene.page)}`, { waitUntil: 'load' })
    // The frames default to a near-black warm gray that suits Gruvbox. Use PREVIEW_BEZEL for another theme.
    if (process.env.PREVIEW_BEZEL) {
      await page.addStyleTag({ content: `:root { --bezel: ${process.env.PREVIEW_BEZEL}; }` })
    }
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())))
    await page.screenshot({
      path: join(work, scene.out),
      omitBackground: true,
      clip: { x: 0, y: 0, width: scene.width, height: scene.height },
    })
    await page.close()
    console.log(`compose: ${scene.out}`)
  }
} finally {
  await browser.close()
}
console.log('compose: done')
