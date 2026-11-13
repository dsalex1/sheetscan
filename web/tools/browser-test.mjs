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
    await checkEditor()
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

/** What a user does next: tempo, accidentals, an edit, playback, the two downloads. */
async function checkEditor() {
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${detail ? ': ' + detail : ''}`)
    if (!ok) process.exitCode = 1
  }
  const xml = () => page.evaluate(() => window.sheetscan.xml)
  const count = (text, pattern) => (text.match(pattern) ?? []).length

  // The sample states no tempo, so the field shows the default; setting it must reach the score.
  check('tempo field', (await page.inputValue('#bpm')) === '120', await page.inputValue('#bpm'))
  await page.fill('#bpm', '90')
  await page.dispatchEvent('#bpm', 'change')
  await page.waitForTimeout(1500)
  check('tempo change reaches the score', /<sound tempo="90"/.test(await xml()))

  // Every accidental the reading needs is drawn (the chorale has a few against its A major key).
  const marked = count(await xml(), /<accidental>/g)
  const drawn = await page.locator('#score g.accid use').count()
  check('accidentals marked and drawn', marked > 0 && drawn === marked, `${marked} marked, ${drawn} drawn`)

  // Select a note, move it up a step, undo. Each step redraws the score: wait for it.
  const before = await xml()
  const note = page.locator('#score g.note .notehead').nth(3)
  await note.scrollIntoViewIfNeeded()
  const box = await note.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const selected = await page.waitForSelector('#score .selected', { timeout: 5000 }).then(() => true, () => false)
  await page.keyboard.press('ArrowUp')
  const moved = await page.waitForFunction((was) => window.sheetscan.xml !== was, before, { timeout: 5000 }).then(() => true, () => false)
  await page.keyboard.press('Control+z')
  const undone = await page.waitForFunction((was) => window.sheetscan.xml === was, before, { timeout: 5000 }).then(() => true, () => false)
  check('edit a note, undo it', selected && moved && undone, `selected ${selected}, moved ${moved}, undone ${undone}`)

  await page.click('#play')
  await page.waitForTimeout(1500)
  check('playback highlights notes', (await page.locator('#score .playing').count()) > 0)
  await page.click('#play')

  for (const [button, pattern] of [['#save-xml', /^<\?xml[\s\S]*<score-partwise/], ['#save-midi', /^MThd/]]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)])
    const chunks = []
    for await (const chunk of await download.createReadStream()) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('latin1')
    check(`download ${download.suggestedFilename()}`, pattern.test(text), `${text.length} bytes`)
  }
}
