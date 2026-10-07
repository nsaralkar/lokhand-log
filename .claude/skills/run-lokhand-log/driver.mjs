#!/usr/bin/env node
// Drive the lokhand-log PWA from the shell. A headless Chromium stays alive
// between invocations (CDP on $CDP_PORT), so every `run` continues where the last
// one left off: same tab, same login cookie, same in-progress workout.
//
//   node driver.mjs open [url]      # launch browser (idempotent), goto url (default $BASE)
//   node driver.mjs run <<'EOF'     # run JS with helpers in scope; return value printed
//     await login(); await tab('stats'); await ss('stats')
//   EOF
//   node driver.mjs ss [name]       # screenshot current page
//   node driver.mjs url             # print current URL + visible text (first 1500 chars)
//   node driver.mjs close           # kill the browser
//
// Helpers inside `run`: page, BASE, ss(name), login(user='demo', pass='demo'),
//   tab(name)   -> open the ☰ drawer and pick home|session|routines|library|history|stats|body
//   pause(ms), text() -> document.body.innerText
// Env: BASE (http://127.0.0.1:5283) CDP_PORT (9333) OUT (<RUN_DIR>/shots) DSF (2)
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
// playwright is a devDependency of the frontend, not installed globally.
const { chromium } = createRequire(join(APP, 'frontend/package.json'))('playwright')

const LIBS = join(process.env.CHROME_LIBS || join(homedir(), '.cache', 'lokhand-log-chrome-libs'), 'root/usr/lib/x86_64-linux-gnu')
const RUN_DIR = process.env.RUN_DIR || join(process.env.TMPDIR || tmpdir(), 'lokhand-log-run')
const BASE = process.env.BASE || 'http://127.0.0.1:5283'
const CDP_PORT = process.env.CDP_PORT || '9333'
const OUT = process.env.OUT || join(RUN_DIR, 'shots')
const PID_FILE = join(RUN_DIR, 'chrome.pid')
// 360x800 = Pixel 8a CSS viewport, same as frontend/scripts/shot.mjs.
const W = 360, H = 800, DSF = process.env.DSF || '2'

function chromeExe() {
  if (process.env.CHROME) return process.env.CHROME
  const root = join(homedir(), '.cache', 'ms-playwright')
  const builds = existsSync(root) ? readdirSync(root).sort().reverse() : []
  for (const d of builds) {
    for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome']) {
      if (existsSync(join(root, d, rel))) return join(root, d, rel)
    }
  }
  throw new Error('no chromium found; run: cd frontend && npx playwright install chromium-headless-shell')
}

const cdpUp = async () => {
  try { return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok } catch { return false }
}

async function open(url) {
  if (!(await cdpUp())) {
    mkdirSync(RUN_DIR, { recursive: true })
    // Host has no libatk/libgbm/... and no passwordless sudo: chrome-libs.sh unpacks
    // the .debs into this dir, and we point the loader at it.
    const env = { ...process.env }
    if (existsSync(LIBS)) env.LD_LIBRARY_PATH = [LIBS, env.LD_LIBRARY_PATH].filter(Boolean).join(':')
    const log = join(RUN_DIR, 'chrome.log')
    // Fresh profile per browser launch: the app keeps the in-progress workout in
    // localStorage, and a stale one (session_id from a previous temp data dir)
    // replaces "Start empty workout" with a ghost session.
    rmSync(join(RUN_DIR, 'chrome-profile'), { recursive: true, force: true })
    const child = spawn(chromeExe(), [
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(RUN_DIR, 'chrome-profile')}`,
      `--window-size=${W},${H}`, `--force-device-scale-factor=${DSF}`,
      '--no-sandbox', '--no-first-run', '--disable-gpu', '--mute-audio', 'about:blank',
    ], { detached: true, stdio: ['ignore', 'ignore', openSync(log, 'w')], env })
    child.unref()
    writeFileSync(PID_FILE, String(child.pid))
    for (let i = 0; i < 50 && !(await cdpUp()); i++) await new Promise((r) => setTimeout(r, 100))
    if (!(await cdpUp())) {
      throw new Error(`chromium did not open CDP on :${CDP_PORT}. ${log}:\n${readFileSync(log, 'utf8').slice(-800)}`)
    }
  }
  return withPage(async (page) => {
    if (url || page.url() === 'about:blank') await page.goto(url || BASE, { waitUntil: 'networkidle' })
    return page.url()
  })
}

async function withPage(fn) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] || (await ctx.newPage())
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  try {
    return await fn(page)
  } finally {
    if (problems.length) console.error(problems.join('\n'))
    // No browser.close(): the browser is shared across invocations. The open CDP
    // websocket keeps node alive, so the CLI below process.exit()s explicitly.
  }
}

function helpers(page) {
  const pause = (ms) => page.waitForTimeout(ms)
  return {
    page, BASE, pause,
    text: () => page.evaluate(() => document.body.innerText),
    ss: async (name = 'shot') => {
      mkdirSync(OUT, { recursive: true })
      const path = join(OUT, `${name}.png`)
      await page.screenshot({ path })
      console.log(`screenshot: ${path}`)
      return path
    },
    login: async (user = 'demo', pass = 'demo') => {
      if (!(await page.getByRole('button', { name: 'Log in' }).count())) return 'already logged in'
      await page.locator('input').first().fill(user)
      await page.locator('input[type=password]').fill(pass)
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.getByLabel('Menu').waitFor()
      return 'logged in'
    },
    tab: async (name) => {
      await page.getByLabel('Menu').click()
      await page.locator('nav.drawer.open').getByRole('button', { name, exact: true }).click()
      await pause(400)
    },
  }
}

const [cmd, arg] = process.argv.slice(2)
const print = (v) => v !== undefined && console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
try {
  if (cmd === 'open') print(await open(arg))
  else if (cmd === 'run') {
    const code = readFileSync(0, 'utf8')
    const AsyncFn = Object.getPrototypeOf(async () => {}).constructor
    const h = helpers
    print(await withPage((page) => {
      const env = h(page)
      return new AsyncFn(...Object.keys(env), code)(...Object.values(env))
    }))
  } else if (cmd === 'ss') await withPage((page) => helpers(page).ss(arg))
  else if (cmd === 'url') print(await withPage(async (p) => `${p.url()}\n---\n${(await helpers(p).text()).slice(0, 1500)}`))
  else if (cmd === 'close') {
    if (existsSync(PID_FILE)) {
      try { process.kill(-Number(readFileSync(PID_FILE, 'utf8')), 'SIGTERM') } catch { /* already gone */ }
      rmSync(PID_FILE)
    }
    // The pid file can be missing (deleted RUN_DIR) and killing the group can leave
    // renderer children behind, so also sweep by the unique CDP flag.
    spawnSync('pkill', ['-f', `--remote-debugging-port=${CDP_PORT}`])
    for (let i = 0; i < 30 && (await cdpUp()); i++) await new Promise((r) => setTimeout(r, 100))
    print((await cdpUp()) ? `chromium still answering on :${CDP_PORT}` : 'closed')
  } else {
    console.error('usage: driver.mjs open [url] | run < script.js | ss [name] | url | close')
    process.exit(2)
  }
  process.exit(0)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
