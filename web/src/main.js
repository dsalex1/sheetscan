import { annotate, tokens } from './annotate.js'
import { loadPages } from './input.js'
import { Player } from './player.js'
import { Score, verovio } from './score.js'

const $ = (id) => document.getElementById(id)
const show = (view) => (document.body.dataset.view = view)
const worker = new Worker(new URL('./omr.worker.js', import.meta.url), { type: 'module' })
const player = new Player()

let pages = [] // the scanned pages: {png, url, width, height, text}
let score = null
let selected = null // id of the selected note
let midi = '' // base64, kept current for the MIDI download

// For tests and the curious: the current score from the console.
window.sheetscan = { get xml() { return score?.xml } }

// ---------- scanning ----------

async function scan(files) {
  if (!files.length) return
  show('busy')
  progress('Preparing pages…')
  $('thumbs').replaceChildren()
  try {
    pages = await loadPages(files, (n) => progress(`Preparing page ${n}…`))
  } catch (e) {
    return fail(`Could not read that file: ${e.message}`)
  }
  $('thumbs').replaceChildren(...pages.map((p) => Object.assign(new Image(), { src: p.url })))
  // Copies go to the worker; the originals stay here for the side-by-side view.
  worker.postMessage({ type: 'scan', pages: pages.map((p) => p.png) })
}

function progress(text, done, total) {
  $('status').textContent = text
  $('bar').style.width = total ? `${(100 * done) / total}%` : '0'
}

function fail(text) {
  show('start')
  $('unsupported').hidden = false
  $('unsupported').textContent = text
}

const DETAILS = [
  [/Starting Inference/, 'Finding staves and symbols…'],
  [/Found (\d+) connected staffs/, (m) => `Found ${m[1]} systems`],
  [/Running TrOmr inference on staff image (\d+)/, (m) => `Reading staff ${+m[1] + 1}…`],
  [/page (\d+) skipped/, (m) => `Page ${m[1]} has no music, skipped`],
]

worker.onmessage = async ({ data }) => {
  if (data.type === 'status') {
    progress(data.text, data.done, data.total)
    if (/Reading page/.test(data.text))
      [...$('thumbs').children].forEach((img, i) => (img.className = i < data.done ? 'done' : i === data.done ? 'now' : ''))
  } else if (data.type === 'log') {
    for (const [pattern, text] of DETAILS) {
      const m = data.text.match(pattern)
      if (m) $('detail').textContent = typeof text === 'string' ? text : text(m)
    }
  } else if (data.type === 'error') fail(data.text)
  else if (data.type === 'result') await open(data.xml)
}

async function open(xml) {
  score = new Score(xml)
  selected = null
  annotate(score.doc, pages.map((p) => tokens(p.text)))
  $('title').value = score.title
  $('scan').replaceChildren(...pages.map(scanPage))
  show('work')
  await draw()
}

// ---------- the two panes ----------

function scanPage(page, index) {
  const div = document.createElement('div')
  div.className = 'page'
  div.append(Object.assign(new Image(), { src: page.url }))
  div.onclick = (e) => {
    // Select the note which was read closest to the click.
    const box = div.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * page.width
    const y = ((e.clientY - box.top) / box.height) * page.height
    let best = null
    for (const el of $('score').querySelectorAll('g.note, g.rest')) {
      const at = place(el.id)
      if (at?.page !== index) continue
      const d = Math.hypot(at.x - x, at.y - y)
      if (!best || d < best.d) best = { d, id: el.id }
    }
    if (best) select(best.id, true)
  }
  return div
}

/** Where on the scan a note was read; its id says so (see pipeline.py). */
function place(id) {
  const m = /-p(\d+)-(\d+)-(\d+)$/.exec(id ?? '')
  return m && { page: +m[1], x: +m[2], y: +m[3] }
}

async function draw() {
  const pane = $('score')
  const scroll = pane.scrollTop
  const svgs = await score.render(Math.max(pane.clientWidth - 28, 320))
  pane.innerHTML = svgs.map((svg) => `<div class="page">${svg}</div>`).join('')
  pane.scrollTop = scroll
  midi = player.load(await verovio())
  select(selected)
  $('undo').disabled = !score.done.length
  $('redo').disabled = !score.undone.length
}

function select(id, reveal = false) {
  const pane = $('score')
  pane.querySelector('.selected')?.classList.remove('selected')
  const el = id && pane.querySelector(`#${CSS.escape(id)}`)
  selected = el ? id : null
  el?.classList.add('selected')
  if (el && reveal) el.scrollIntoView({ block: 'center', behavior: 'smooth' })

  document.querySelector('.marker')?.remove()
  const at = place(selected)
  const page = at && $('scan').children[at.page]
  if (page) {
    const marker = Object.assign(document.createElement('div'), { className: 'marker' })
    marker.style.left = `${(100 * at.x) / pages[at.page].width}%`
    marker.style.top = `${(100 * at.y) / pages[at.page].height}%`
    page.append(marker)
    marker.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  for (const button of $('inspector').querySelectorAll('button')) button.disabled = !selected
  $('hint').textContent = selected ? '' : 'Click a note to edit it. ← → move between notes.'
}

$('score').onclick = (e) => {
  // Noteheads are small targets: take the closest one within reach of the click.
  let best = { d: 14, id: null }
  for (const el of $('score').querySelectorAll('g.note, g.rest')) {
    const box = (el.querySelector('.notehead') ?? el).getBoundingClientRect()
    const d = Math.hypot(
      Math.max(box.left - e.clientX, 0, e.clientX - box.right),
      Math.max(box.top - e.clientY, 0, e.clientY - box.bottom),
    )
    if (d < best.d) best = { d, id: el.id }
  }
  select(best.id)
}

// ---------- editing ----------

async function edit(action, arg) {
  if (!score) return
  player.stop()
  if (action === 'undo' || action === 'redo') {
    if (!score[action]()) return
  } else if (action === 'add') {
    const added = score.add(selected)
    if (!added) return
    selected = added
  } else if (!score[action](selected, arg)) return
  await draw()
  const sounding = player.notes.find((n) => n.id === selected)
  if (sounding && ['move', 'alter', 'add'].includes(action)) player.ping(sounding.pitch)
}

$('inspector').onclick = (e) => {
  const button = e.target.closest('button')
  if (button) edit(button.dataset.do, button.dataset.arg === undefined ? undefined : +button.dataset.arg)
}
$('undo').onclick = () => edit('undo')
$('redo').onclick = () => edit('redo')
$('title').onchange = (e) => (score.title = e.target.value)

function step(by) {
  const all = [...$('score').querySelectorAll('g.note, g.rest')]
  const next = all[all.findIndex((el) => el.id === selected) + by] ?? all[by > 0 ? 0 : all.length - 1]
  if (next) select(next.id, true)
}

const KEYS = {
  ArrowUp: (e) => edit('move', e.shiftKey ? 7 : 1),
  ArrowDown: (e) => edit('move', e.shiftKey ? -7 : -1),
  ArrowLeft: () => step(-1),
  ArrowRight: () => step(1),
  '+': () => edit('alter', 1), '=': () => edit('alter', 1), '-': () => edit('alter', -1), n: () => edit('alter', 0),
  '.': () => edit('dot'), r: () => edit('rest'), a: () => edit('add'),
  Delete: () => edit('remove'), Backspace: () => edit('remove'),
  ' ': () => togglePlay(),
  z: (e) => e.ctrlKey || e.metaKey ? edit(e.shiftKey ? 'redo' : 'undo') : false,
  y: (e) => e.ctrlKey || e.metaKey ? edit('redo') : false,
}
for (let i = 0; i < 6; i++) KEYS[i + 1] = () => edit('duration', i)

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'work' || e.target.matches('input[type=text]')) return
  const action = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
  if (action && action(e) !== false) e.preventDefault()
})

// ---------- playback ----------

function togglePlay() {
  if (player.playing) return player.stop()
  const pane = $('score')
  let shown = []
  $('play').textContent = '■ Stop'
  player.play(
    player.notes.find((n) => n.id === selected)?.t ?? 0,
    (ids) => {
      shown.forEach((el) => el.classList.remove('playing'))
      shown = ids.map((id) => pane.querySelector(`#${CSS.escape(id)}`)).filter(Boolean)
      shown.forEach((el) => el.classList.add('playing'))
      const box = shown[0]?.getBoundingClientRect()
      const view = pane.getBoundingClientRect()
      if (box && (box.bottom > view.bottom - 40 || box.top < view.top)) shown[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    () => {
      shown.forEach((el) => el.classList.remove('playing'))
      $('play').textContent = '▶ Play'
    },
  )
}
$('play').onclick = togglePlay
$('speed').oninput = (e) => {
  player.speed = e.target.value / 100
  player.stop()
}

// ---------- files in, files out ----------

function download(name, type, content) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}
const fileName = () => (score.title.trim() || 'score').replace(/[\\/:*?"<>|]+/g, '_')
$('save-xml').onclick = () => download(`${fileName()}.musicxml`, 'application/vnd.recordare.musicxml+xml', score.xml)
$('save-midi').onclick = () => download(`${fileName()}.mid`, 'audio/midi', Uint8Array.from(atob(midi), (c) => c.charCodeAt(0)))
$('again').onclick = () => {
  player.stop()
  show('start')
}
$('toggle-scan').onclick = () => {
  document.body.classList.toggle('no-scan')
  if (score) draw()
}

$('files').onchange = (e) => scan([...e.target.files])
$('sample').onclick = async () => scan([new File([await (await fetch('sample.png')).blob()], 'sample.png')])
addEventListener('dragover', (e) => (e.preventDefault(), document.body.classList.add('dragging')))
addEventListener('dragleave', () => document.body.classList.remove('dragging'))
addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  scan([...e.dataTransfer.files])
})
addEventListener('paste', (e) => scan([...e.clipboardData.files]))
let resizing
addEventListener('resize', () => {
  clearTimeout(resizing)
  resizing = setTimeout(() => score && document.body.dataset.view === 'work' && draw(), 250)
})

if (typeof WebAssembly.Suspending !== 'function') {
  $('unsupported').hidden = false
  $('unsupported').textContent = 'This browser cannot run the recogniser yet (it lacks WebAssembly JSPI). Please use a current Chrome, Edge or Firefox.'
}

// Development: ?demo=a.png,b.png scans images served next to the app;
// with &xml=result.musicxml it skips recognition and opens that result for them.
const query = new URLSearchParams(location.search)
if (query.get('demo')) {
  const files = await Promise.all(query.get('demo').split(',').map(async (u) => new File([await (await fetch(u)).blob()], u)))
  if (!query.get('xml')) scan(files)
  else {
    pages = await loadPages(files)
    open(await (await fetch(query.get('xml'))).text())
  }
}
