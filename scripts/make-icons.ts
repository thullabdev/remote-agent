// Rasterizes public/icon.svg into the PNG icons the manifest and apple-touch-icon use.
// Run after editing icon.svg: bun run icons
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const publicDir = join(import.meta.dirname, '..', 'public')
const svg = readFileSync(join(publicDir, 'icon.svg'), 'utf8')
const sizes = [180, 192, 512]

for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(join(publicDir, `icon-${size}.png`), png)
  console.log(`wrote public/icon-${size}.png (${size}x${size})`)
}
