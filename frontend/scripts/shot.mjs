// Dev tool: render the running app in headless Chromium at the Pixel 8a
// viewport and screenshot key screens into ./shots. Lets us (and Claude) get
// direct visual feedback without a device.
//
//   npm run shot                 # app on :5173, demo/demo
//   BASE=http://localhost:4173 npm run shot
//   SHOT_LOG=1 npm run shot      # also capture the rest timer (logs+deletes a set)
//
// Footprint: starting a workout appends an (uncommitted) session_start to the
// demo data; SHOT_LOG additionally logs a set and deletes it (one commit). Point
// BASE at a throwaway backend if you want zero footprint on your real data.
//
// Browser resolution order: $CHROME → a cached Playwright chromium build →
// Playwright's own default. If none exist, run: npx playwright install chromium
import { chromium } from 'playwright'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:5173'
const OUT = process.env.OUT || 'shots'
const USER = process.env.USER_NAME || 'demo'
const PASS = process.env.USER_PASS || 'demo'

function resolveBrowser() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME
  const root = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(root)) {
    const builds = readdirSync(root)
      .filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-'))
      .sort().reverse()  // zero-padded build ids → newest last, so reverse to try newest first
    for (const d of builds) {
      for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const exe = join(root, d, rel)
        if (existsSync(exe)) return exe
      }
    }
  }
  return undefined  // let Playwright resolve its default install
}

mkdirSync(OUT, { recursive: true })
const exe = resolveBrowser()
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const page = await (await browser.newContext({
  viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
})).newPage()

const shots = []
const shot = async (name) => {
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path })
  shots.push(path)
}
const pause = (ms) => page.waitForTimeout(ms)

await page.goto(BASE, { waitUntil: 'networkidle' })

// 1. Login screen, then authenticate.
if (await page.getByText('Log in').count()) {
  await shot('01-login')
  await page.locator('input').first().fill(USER)
  await page.locator('input[type=password]').fill(PASS)
  await page.getByText('Log in').click()
  await pause(800)
}

// 2. Home hub, then into the Workout page.
await shot('02-home')
await page.getByRole('button', { name: 'Workout', exact: true }).click()
await pause(400)
await shot('02b-start')

// 3. Empty logging screen.
const startBtn = page.getByText('Start empty workout')
if (await startBtn.count()) {
  await startBtn.click()
  await pause(500)
  await shot('03-logging-empty')

  // 4. Pick an exercise with history → weight/reps autofill.
  await page.getByPlaceholder('start typing…').fill('Chest Press, Incline, DB')
  await pause(900)
  await shot('04-autofill')

  // 5. History subtab (per current exercise): e1RM plot then session list.
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await pause(700); await shot('05-history')
  await page.getByRole('button', { name: 'Exercise', exact: true }).click()
  await pause(200)

  // 8. (opt-in, SHOT_LOG=1) The rest timer that replaces the Log-set button.
  //    This one MUTATES the demo dataset: it logs a set, screenshots, then
  //    deletes the set via the UI to clean up (a delete is one git commit).
  if (process.env.SHOT_LOG) {
    await page.getByRole('button', { name: 'Log set', exact: true }).click()
    await pause(600)
    await shot('08-resting')
    await page.locator('button.ghost.danger').first().click()          // ✕ on the logged set
    await pause(200)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()  // confirm modal
    await pause(300)
  }
}

// 7. Left drawer nav.
await page.getByLabel('Menu').click()
await pause(400)
await shot('07-drawer')

await browser.close()
console.log(`wrote ${shots.length} screenshots to ${OUT}/`)
