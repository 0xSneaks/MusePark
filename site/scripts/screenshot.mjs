// Serves ./out and captures pages at phone width with Playwright Chromium.
// Usage: node scripts/screenshot.mjs [width=380]
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = path.resolve('out')
const WIDTH = Number(process.argv[2] ?? 380)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

const server = createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html')
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' })
  res.end(readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath })
mkdirSync('screenshots', { recursive: true })
const shots = []
for (const scheme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' })
  await page.goto(`${base}/reveal/`, { waitUntil: 'networkidle' })
  const sealed = `screenshots/reveal-${WIDTH}-${scheme}-sealed.png`
  await page.screenshot({ path: sealed, fullPage: true })
  await page.getByRole('button', { name: 'Break all seals' }).click()
  await page.waitForTimeout(300)
  const opened = `screenshots/reveal-${WIDTH}-${scheme}-open.png`
  await page.screenshot({ path: opened, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  shots.push({ scheme, sealed, opened, horizontalOverflowPx: overflow })
  await page.close()
}
for (const route of ['/', '/arena/dispute_flips_with_withheld_evidence/', '/leaderboard/', '/fees/', '/join/', '/agents/8df791a9ac6019d55acc0650c6be7d612114f44b00b26e5582cb047fd23c26e8/']) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' })
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const name = `screenshots/${WIDTH}${route.replaceAll('/', '_') || '_root'}.png`
  await page.screenshot({ path: name, fullPage: true })
  shots.push({ route, file: name, horizontalOverflowPx: overflow })
  await page.close()
}
await browser.close()
server.close()
console.log(JSON.stringify(shots, null, 2))
