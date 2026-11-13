// The score being edited: a MusicXML document, rendered by Verovio, changed note by note.
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'

const STEPS = 'CDEFGAB'
const SHARPS = 'FCGDAEB' // order in which key signatures add sharps; flats are the reverse
export const TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd']
const ACCIDENTALS = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' }
// MusicXML fixes the order of a <note>'s children; these come after <type>, in this order.
const TAIL = ['dot', 'accidental', 'time-modification', 'stem', 'notehead', 'staff', 'beam', 'notations', 'lyric']
const SCALE = 42

let toolkit
export const verovio = async () => (toolkit ??= new VerovioToolkit(await createVerovioModule()))

const child = (el, name) => [...el.children].find((c) => c.tagName === name)
const isChordNote = (el) => el?.tagName === 'note' && !!child(el, 'chord')

/** Create, update or (text == null) remove the child `name`, placed before the first of `before`. */
function setChild(el, name, text, before = []) {
  let c = child(el, name)
  if (text == null) return c?.remove()
  if (!c) {
    c = el.ownerDocument.createElement(name)
    el.insertBefore(c, [...el.children].find((x) => before.includes(x.tagName)) ?? null)
  }
  c.textContent = text
}
const after = (name) => TAIL.slice(TAIL.indexOf(name) + 1)

/** The last <tag> value in force at a note (key, divisions...), looking back through its part. */
function inForce(note, selector, fallback) {
  let value = fallback
  for (const measure of note.closest('part').children) {
    const found = measure.querySelector(selector)
    if (found) value = +found.textContent
    if (measure.contains(note)) break
  }
  return value
}

function keyAlter(step, fifths) {
  if (fifths > 0) return SHARPS.slice(0, fifths).includes(step) ? 1 : 0
  return [...SHARPS].reverse().slice(0, -fifths).includes(step) ? -1 : 0
}

/**
 * Mark the accidentals a measure has to print: a note gets one when its alteration is not
 * what the key signature, or an earlier accidental on that line in the measure, says.
 * (The recogniser only tells how each note sounds; programs differ in whether they then
 * work out the signs themselves - Verovio, which draws the score here, does not.)
 */
export function spell(measure) {
  const first = measure.querySelector('note')
  const fifths = first ? inForce(first, 'key > fifths', 0) : 0
  const sounding = new Map() // staff/step+octave -> alteration in force
  for (const note of measure.querySelectorAll('note')) {
    const pitch = child(note, 'pitch')
    if (!pitch) {
      setChild(note, 'accidental', null)
      continue
    }
    const step = child(pitch, 'step').textContent
    const line = `${child(note, 'staff')?.textContent ?? 1}/${step}${child(pitch, 'octave').textContent}`
    const alter = +(child(pitch, 'alter')?.textContent ?? 0)
    const expected = sounding.has(line) ? sounding.get(line) : keyAlter(step, fifths)
    const tiedOver = note.querySelector(':scope > tie[type="stop"]')
    setChild(note, 'accidental', alter !== expected && !tiedOver ? ACCIDENTALS[alter] : null, after('accidental'))
    sounding.set(line, alter)
  }
}

/** Recompute <duration> from <type>, dots and tuplet ratio, refining <divisions> if needed. */
function retime(note) {
  const type = TYPES.indexOf(child(note, 'type')?.textContent)
  if (type < 0) return false
  const dots = [...note.children].filter((c) => c.tagName === 'dot').length
  const tuplet = child(note, 'time-modification')
  const ratio = tuplet ? child(tuplet, 'normal-notes').textContent / child(tuplet, 'actual-notes').textContent : 1
  const quarters = (4 / 2 ** type) * (2 - 0.5 ** dots) * ratio
  const part = note.closest('part')
  for (let tries = 0; !Number.isInteger(inForce(note, 'divisions', 1) * quarters) && tries < 6; tries++)
    for (const el of part.querySelectorAll('divisions, duration')) el.textContent = el.textContent * 2
  setChild(note, 'duration', Math.round(inForce(note, 'divisions', 1) * quarters), ['tie', 'voice', 'type', ...TAIL])
}

const BEATS = { half: 2, quarter: 1, eighth: 0.5 } // in quarter notes

/** A <direction> for a tempo: {bpm, unit = 'quarter', dotted, words}. bpm counts units. */
export function tempoMark(doc, { bpm, unit = 'quarter', dotted = false, words }) {
  const el = (name, text) => Object.assign(doc.createElement(name), text == null ? {} : { textContent: text })
  const direction = el('direction')
  direction.setAttribute('placement', 'above')
  if (words) direction.appendChild(el('direction-type')).append(el('words', words))
  if (bpm) {
    const metronome = direction.appendChild(el('direction-type')).appendChild(el('metronome'))
    metronome.append(el('beat-unit', unit), ...(dotted ? [el('beat-unit-dot')] : []), el('per-minute', bpm))
  }
  const sound = direction.appendChild(el('sound'))
  sound.setAttribute('tempo', Math.round(bpm * BEATS[unit] * (dotted ? 1.5 : 1)))
  return direction
}

export class Score {
  constructor(xml) {
    this.doc = new DOMParser().parseFromString(xml, 'application/xml')
    this.doc.querySelectorAll('measure').forEach(spell)
    this.done = []
    this.undone = []
    this.added = 0
  }

  get xml() {
    return new XMLSerializer().serializeToString(this.doc)
  }

  note(id) {
    return this.doc.querySelector(`note[id="${CSS.escape(id)}"]`)
  }

  /** Run a change to the document; it may return false for "does not apply". */
  #change(change) {
    const before = this.xml
    if (change() === false) return false
    this.done.push(before)
    this.undone = []
    return true
  }

  /** Run a change to the note `id`, then put the accidentals of its measure right. */
  #edit(id, change) {
    const note = id && this.note(id)
    const measure = note?.closest('measure')
    return !!note && this.#change(() => (change(note) === false ? false : spell(measure)))
  }

  #restore(from, to) {
    if (!from.length) return false
    to.push(this.xml)
    this.doc = new DOMParser().parseFromString(from.pop(), 'application/xml')
    return true
  }
  undo = () => this.#restore(this.done, this.undone)
  redo = () => this.#restore(this.undone, this.done)

  /** Move a note by diatonic steps (7 = an octave), following the key signature. */
  move(id, steps) {
    return this.#edit(id, (note) => {
      const pitch = child(note, 'pitch')
      if (!pitch) return false
      const at = STEPS.indexOf(child(pitch, 'step').textContent) + 7 * child(pitch, 'octave').textContent + steps
      const step = STEPS[((at % 7) + 7) % 7]
      child(pitch, 'step').textContent = step
      child(pitch, 'octave').textContent = Math.floor(at / 7)
      if (steps % 7) setChild(pitch, 'alter', keyAlter(step, inForce(note, 'key > fifths', 0)) || null, ['octave'])
    })
  }

  /** Set a note's accidental: -1 flat, 0 natural, 1 sharp. */
  alter(id, value) {
    return this.#edit(id, (note) => {
      const pitch = child(note, 'pitch')
      if (!pitch) return false
      setChild(pitch, 'alter', value, ['octave']) // 0 too: a natural against the key signature
    })
  }

  /** Set the note value: an index into TYPES. Clears dots. */
  duration(id, type) {
    return this.#edit(id, (note) => {
      note.querySelectorAll(':scope > dot').forEach((dot) => dot.remove())
      note.querySelector(':scope > rest')?.removeAttribute('measure')
      setChild(note, 'type', TYPES[type], TAIL)
      return retime(note)
    })
  }

  dot(id) {
    return this.#edit(id, (note) => {
      setChild(note, 'dot', child(note, 'dot') ? null : '', after('dot'))
      return retime(note)
    })
  }

  /** Note <-> rest. */
  rest(id) {
    return this.#edit(id, (note) => {
      const old = child(note, 'pitch') ?? child(note, 'rest')
      if (isChordNote(note) || isChordNote(note.nextElementSibling) || !old) return false
      const made = this.doc.createElement(old.tagName === 'pitch' ? 'rest' : 'pitch')
      if (made.tagName === 'pitch') {
        setChild(made, 'step', 'B')
        setChild(made, 'octave', 4)
      }
      old.replaceWith(made)
    })
  }

  /** Delete: a chord loses the note, a lone note becomes a rest. */
  remove(id) {
    return this.#edit(id, (note) => {
      const next = note.nextElementSibling
      if (isChordNote(note)) return note.remove()
      if (isChordNote(next)) {
        child(next, 'chord').remove()
        return note.remove()
      }
      if (!child(note, 'pitch')) return false
      child(note, 'pitch').replaceWith(this.doc.createElement('rest'))
    })
  }

  /** Add a note a third above to the chord; returns the new note's id. */
  add(id) {
    const newId = `u${++this.added}`
    const ok = this.#edit(id, (note) => {
      if (!child(note, 'pitch')) return false
      const copy = note.cloneNode(true)
      copy.setAttribute('id', newId)
      for (const name of ['notations', 'lyric', 'accidental']) setChild(copy, name, null)
      if (!isChordNote(copy)) copy.prepend(this.doc.createElement('chord'))
      let last = note
      while (isChordNote(last.nextElementSibling)) last = last.nextElementSibling
      last.after(copy)
    })
    if (!ok) return null
    this.move(newId, 2)
    this.done.pop() // the two steps are one change to undo
    return newId
  }

  get title() {
    return this.doc.querySelector('work > work-title')?.textContent ?? ''
  }
  set title(text) {
    const root = this.doc.documentElement
    const work = child(root, 'work') ?? root.insertBefore(this.doc.createElement('work'), root.firstChild)
    setChild(work, 'work-title', text)
  }

  /** Quarter notes per minute at the start (120 if the score says nothing). */
  get tempo() {
    return Math.round(this.doc.querySelector('sound[tempo]')?.getAttribute('tempo') ?? 120)
  }

  /** Set the opening tempo; later tempo changes keep their proportion to it. */
  set tempo(bpm) {
    this.#change(() => {
      const sounds = [...this.doc.querySelectorAll('sound[tempo]')]
      if (!sounds.length) {
        const first = this.doc.querySelector('part > measure > note')
        first?.parentNode.insertBefore(tempoMark(this.doc, { bpm }), first)
        return
      }
      const factor = bpm / sounds[0].getAttribute('tempo')
      for (const sound of sounds) {
        sound.setAttribute('tempo', Math.round(sound.getAttribute('tempo') * factor))
        const shown = sound.parentNode.querySelector('per-minute')
        if (shown) shown.textContent = Math.round(shown.textContent * factor)
      }
    })
  }

  /** Lay the score out `width` pixels wide; returns one SVG string per page. */
  async render(width) {
    const tk = await verovio()
    tk.setOptions({
      scale: SCALE, pageWidth: Math.round((width * 100) / SCALE), pageHeight: 2970, adjustPageHeight: true,
      header: 'none', footer: 'none', breaks: 'auto', svgViewBox: true, pageMarginTop: 80,
    })
    tk.loadData(this.xml)
    return Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1))
  }
}
