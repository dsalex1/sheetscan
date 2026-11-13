// Scan the sample page in a real browser engine and check the result note for note.
//
//   node tools/browser-test.mjs [webkit|chromium|firefox] [url] [--nojspi]
//
// Default: WebKit (the engine of Safari and of every iOS browser) against the dev server.
// --nojspi forces the shared-memory bridge which browsers without WebAssembly JSPI take.
// Needs `npx playwright install <engine>`.
import { createHash } from 'node:crypto'
import * as playwright from 'playwright'

// What the native pipeline reads on bench/sample/p1.png (it scores 1.000 against the truth).
const EXPECTED = '8e526eb7db347e574dc72023d8d870860dc7e9f28009072580106a14b48023cb'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const engine = args[0] ?? 'webkit'
const url = args[1] ?? 'http://localhost:5173/'
const browser = await playwright[engine].launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
await page.goto(url + (process.argv.includes('--nojspi') ? '?nojspi' : ''))
console.log(engine, browser.version(), await page.evaluate(() => ({
  jspi: typeof WebAssembly.Suspending === 'function',
  isolated: crossOriginIsolated,
  memory: navigator.deviceMemory,
})))

await page.click('#sample')
const started = Date.now()
let last = ''
for (;;) {
  const state = await page.evaluate(() => ({
    view: document.body.dataset.view,
    status: `${document.getElementById('status').textContent} ${document.getElementById('detail').textContent}`,
    error: document.getElementById('unsupported').textContent,
    xml: window.sheetscan.xml ?? null,
    bridge: window.sheetscan.bridge,
  }))
  if (state.status !== last) console.log(`${Math.round((Date.now() - started) / 1000)}s`, (last = state.status))
  if (state.error) {
    console.log('FAILED:', state.error)
    process.exitCode = 1
    break
  }
  if (state.view === 'work' && state.xml) {
    // The same fingerprint bench computes: every note's pitch and duration, in order.
    const notes = [...state.xml.matchAll(/<note[\s\S]*?<\/note>/g)].map(([note]) => {
      const tag = (name) => note.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
      return `${note.includes('<pitch>') ? tag('step') + (tag('alter') ?? '') + tag('octave') : 'r'}:${tag('duration')}`
    })
    const hash = createHash('sha256').update(notes.join(',')).digest('hex')
    console.log(`${notes.length} notes via ${state.bridge} in ${Math.round((Date.now() - started) / 1000)}s:`, hash === EXPECTED ? 'identical to the native reading' : `DIFFERENT (${hash})`)
    if (hash !== EXPECTED) process.exitCode = 1
    break
  }
  if (Date.now() - started > 15 * 60_000) {
    console.log('FAILED: timed out')
    process.exitCode = 1
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
await browser.close()
