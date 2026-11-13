// Puts the text found on the pages into the score: title, composer, tempo, lyrics, chord symbols.
// Text is a list of {str, x, y, h, w} per page (baseline start, font height, width, in
// page-image pixels) from the PDF's text layer or from OCR. Staff positions come from
// the recogniser (the "staff-layout" field), note positions from the note ids.

import { tempoMark } from './score.js'

// A root, a quality built from the usual pieces only (so words like "Der" don't match), a bass.
const CHORD = /^([A-G])([#b♯♭]?)((?:maj|min|dim|aug|sus|add|omit|no|m|M|\d|[#b♯♭+°ø△()\-,])*)(?:\/([A-G])([#b♯♭]?))?$/
const KINDS = {
  '': 'major', m: 'minor', min: 'minor', '-': 'minor', 7: 'dominant', maj7: 'major-seventh', M7: 'major-seventh',
  m7: 'minor-seventh', min7: 'minor-seventh', dim: 'diminished', '°': 'diminished', dim7: 'diminished-seventh',
  aug: 'augmented', '+': 'augmented', sus: 'suspended-fourth', sus4: 'suspended-fourth', sus2: 'suspended-second',
  6: 'major-sixth', m6: 'minor-sixth', 9: 'dominant-ninth', m9: 'minor-ninth', maj9: 'major-ninth',
  m7b5: 'half-diminished', 'ø': 'half-diminished', 5: 'power',
}
const ALTER = { '#': 1, '♯': 1, b: -1, '♭': -1 }

// Music fonts keep their glyphs in the private-use area. A few matter inside text: the
// sharp and flat of chord symbols and the note of a metronome mark (Finale's Maestro
// layout first, then SMuFL). They survive only when they join real text.
const GLYPHS = {
  '\uF023': '#', '\uF062': 'b', '\uF071': 'q', '\uF068': 'h', '\uF065': 'e', '\uF06B': '.',
  '\uE1D5': 'q', '\uECA5': 'q', '\uE1D3': 'h', '\uECA3': 'h', '\uE1D7': 'e', '\uECA7': 'e', '\uE1E7': '.', '\uECB7': '.',
}
const UNITS = { q: 'quarter', h: 'half', e: 'eighth' }
// "q = 156" (the note glyph mapped above), "(q. = ca. 60)", and what OCR makes of the
// note: "J=156", "d = 156" - there the unit is unknown and taken as a quarter.
const METRONOME = /(?:\b([qhe])(\.?))?\s*=\s*(?:c(?:irc)?a\.?\s*)?(\d{2,3})/
const TEMPO_WORDS = {
  grave: 40, largo: 50, larghetto: 60, lento: 54, adagio: 66, andante: 84, andantino: 90, moderato: 108,
  allegretto: 116, allegro: 132, vivace: 160, presto: 176, prestissimo: 200,
}
const TEMPO_WORD = new RegExp(`\\b(${Object.keys(TEMPO_WORDS).join('|')})\\b`, 'i')

/** The tempo a line of text states, if any: {tokens, x, bpm, unit, dotted, words}. */
function readTempo(line) {
  const number = line.map((t) => METRONOME.exec(t.str))
  // OCR may split "J = 156" into pieces: then the whole line has to be read as one.
  const joined = number.some(Boolean) ? null : METRONOME.exec(line.map((t) => t.str).join(' '))
  const word = line.find((t) => TEMPO_WORD.test(t.str))
  const m = number.find(Boolean) ?? joined
  if (!m && !word) return null
  const tokens = joined ? line : line.filter((t, i) => number[i] || t === word)
  return {
    tokens,
    x: Math.min(...tokens.map((t) => t.x)),
    bpm: m ? +m[3] : TEMPO_WORDS[TEMPO_WORD.exec(word.str)[1].toLowerCase()],
    unit: UNITS[m?.[1]] ?? 'quarter',
    dotted: !!m?.[2],
    // Words like "Presto ma dolce" are kept; a bare metronome mark needs none.
    words: word?.str.replace(/\(?\s*\S?\.?\s*=.*$/, '').trim(),
  }
}

/** Join the pieces a PDF splits text into ("C" "sus" "/F") and drop music-font glyphs. */
export function tokens(items) {
  const clean = items
    .map((it) => ({
      ...it,
      music: !/[^\uE000-\uF8FF\s]/.test(it.str),
      str: it.str.replace(/[\uE000-\uF8FF]/g, (glyph) => GLYPHS[glyph] ?? ''),
    }))
    .filter((it) => it.str.trim())
    .sort((a, b) => a.x - b.x)
  const out = []
  for (const it of clean) {
    const gap = (t) => it.x - (t.x + t.w)
    const prev = out.findLast((t) => Math.abs(t.y - it.y) < 0.4 * Math.max(t.h, it.h) && gap(t) < 0.2 * t.h && gap(t) > -0.6 * t.h)
    if (prev) Object.assign(prev, { str: prev.str + it.str, w: it.x + it.w - prev.x, music: prev.music && it.music })
    else out.push({ ...it })
  }
  return out
    .filter((t) => !t.music)
    .map((t) => {
      const compact = t.str.replace(/\s+/g, '') // chord symbols come as "F" + " sus"
      return { ...t, str: CHORD.test(compact) ? compact : t.str.replace(/\s+/g, ' ').trim() }
    })
}

function element(doc, name, text, attrs = {}) {
  const el = doc.createElement(name)
  if (text != null) el.textContent = text
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function harmony(doc, [, step, alter, kind, bassStep, bassAlter], offset) {
  const el = element(doc, 'harmony')
  const root = el.appendChild(element(doc, 'root'))
  root.append(element(doc, 'root-step', step))
  if (alter) root.append(element(doc, 'root-alter', ALTER[alter]))
  el.append(element(doc, 'kind', KINDS[kind] ?? 'other', { text: kind }))
  if (bassStep) {
    const bass = el.appendChild(element(doc, 'bass'))
    bass.append(element(doc, 'bass-step', bassStep))
    if (bassAlter) bass.append(element(doc, 'bass-alter', ALTER[bassAlter]))
  }
  if (offset) el.append(element(doc, 'offset', offset))
  return el
}

const place = (id) => {
  const m = /-p(\d+)-(\d+)-(\d+)$/.exec(id ?? '')
  return m && { page: +m[1], x: +m[2], y: +m[3] }
}

/**
 * Annotate the MusicXML document in place. Returns what it added: {title, lyrics, chords}.
 * `text[p]` is the token list of page p.
 */
export function annotate(doc, text) {
  const field = doc.querySelector('miscellaneous-field[name="staff-layout"]')
  const layout = JSON.parse(field?.textContent ?? '[]')
  field?.parentNode.remove()
  const added = { title: '', lyrics: 0, chords: 0, tempo: 0 }

  // Every note and rest with a known place, filed under the staff it lies closest to.
  const byStaff = new Map() // "page/staff index" -> [{el, x}]
  for (const el of doc.querySelectorAll('note[id]')) {
    const at = place(el.getAttribute('id'))
    const staffs = at && layout[at.page]
    if (!staffs?.length || el.querySelector(':scope > chord, :scope > grace')) continue
    const distance = ([, top, , bottom]) => Math.max(top - at.y, at.y - bottom, 0)
    const index = staffs.reduce((best, s, i) => (distance(s) < distance(staffs[best]) ? i : best), 0)
    const key = `${at.page}/${index}`
    byStaff.set(key, [...(byStaff.get(key) ?? []), { el, x: at.x, pitched: !!el.querySelector(':scope > pitch') }])
  }
  for (const notes of byStaff.values()) notes.sort((a, b) => a.x - b.x)

  /** The note or rest sounding where a chord symbol stands at x, and how far into it. */
  function under(anchors, x, reach) {
    // A whole-bar rest is printed mid-bar: its time starts half a bar to the left.
    const starts = anchors.map((a, i) => {
      const wholeBar = a.el.querySelector(':scope > rest[measure]') || !a.el.querySelector(':scope > type')
      const width = ((anchors[i + 1]?.x ?? a.x) - (anchors[i - 1]?.x ?? a.x)) / (anchors[i + 1] && anchors[i - 1] ? 2 : 1)
      return wholeBar && !a.pitched ? a.x - width / 2 : a.x
    })
    let i = starts.findLastIndex((start) => start <= x + reach)
    if (i < 0) i = 0
    const end = starts[i + 1] ?? starts[i] + 2 * (starts[i] - (starts[i - 1] ?? starts[i]))
    const duration = +(anchors[i].el.querySelector(':scope > duration')?.textContent ?? 0)
    const beat = +(anchors[i].el.closest('part').querySelector('divisions')?.textContent ?? 1)
    const into = end > starts[i] ? Math.min(Math.max((x - starts[i]) / (end - starts[i]), 0), 0.95) : 0
    return { anchor: anchors[i], offset: Math.round((into * duration) / beat) * beat }
  }

  layout.forEach((staffs, page) => {
    const all = text[page] ?? []
    if (!staffs.length || !all.length) return
    const middle = (t) => t.y - 0.35 * t.h
    const inStaff = (t) => staffs.some(([, top, , bottom]) => middle(t) > top && middle(t) < bottom)

    if (!added.title) {
      // The largest text above the first staff is the title; text at the right, the composer.
      const head = all.filter((t) => t.y < staffs[0][1] - (staffs[0][3] - staffs[0][1]) && t.str.length > 1)
      const largest = head.reduce((best, t) => (!best || t.h > best.h ? t : best), null)
      // OCR gives a title word by word: take its whole line.
      const title = largest && {
        ...largest,
        str: head.filter((t) => Math.abs(t.y - largest.y) < 0.5 * largest.h && t.h > 0.7 * largest.h)
          .sort((a, b) => a.x - b.x).map((t) => t.str).join(' '),
      }
      if (title && page === Math.min(...layout.map((s, i) => (s.length ? i : Infinity)))) {
        added.title = title.str
        const composer = head.filter((t) => t.h < 0.7 * title.h && t.x + t.w / 2 > (staffs[0][0] + staffs[0][2]) / 2)
          .reduce((best, t) => (!best || t.y > best.y ? t : best), null)
        const root = doc.documentElement
        root.querySelector(':scope > work')?.remove()
        root.insertBefore(element(doc, 'work'), root.firstChild).append(element(doc, 'work-title', title.str))
        if (composer) root.querySelector(':scope > identification').prepend(element(doc, 'creator', composer.str, { type: 'composer' }))
      }
    }

    // Lines of text between the staves: chord symbols belong to the staff below,
    // lyrics to the staff above.
    // OCR gives each word its own box, so baselines and heights wobble: group generously.
    const heights = all.map((t) => t.h).sort((a, b) => a - b)
    const typical = heights[heights.length >> 1]
    const lines = []
    for (const t of all.filter((t) => !inStaff(t)).sort((a, b) => a.y - b.y)) {
      const line = lines.at(-1)
      if (line && t.y - line[0].y < 0.5 * Math.max(t.h, typical)) line.push(t)
      else lines.push([t])
    }
    const verses = new Map() // staff index -> lyric lines so far
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      const y = middle(line[0])
      const above = staffs.map((s, i) => [y - s[3], i]).filter(([d]) => d > 0).sort((a, b) => a[0] - b[0])[0]
      const below = staffs.map((s, i) => [s[1] - y, i]).filter(([d]) => d > 0).sort((a, b) => a[0] - b[0])[0]
      const unit = (i) => (staffs[i][3] - staffs[i][1]) / 4
      const nearerBelow = below && (!above || below[0] < above[0])

      // A tempo stands above its staff, perhaps beside other text on the same line.
      const tempo = nearerBelow && below[0] < 12 * unit(below[1]) && readTempo(line)
      const anchors = byStaff.get(`${page}/${below?.[1]}`) ?? []
      if (tempo && anchors.length) {
        const { anchor } = under(anchors, tempo.x, unit(below[1]))
        anchor.el.parentNode.insertBefore(tempoMark(doc, tempo), anchor.el)
        added.tempo++
        line.splice(0, line.length, ...line.filter((t) => !tempo.tokens.includes(t)))
        if (!line.length) continue
      }

      const chords = line.map((t) => CHORD.exec(t.str))
      // Chord symbols sit close above their staff, lyrics close below theirs: the nearer
      // staff says which a line is. (Its words alone don't: OCR garbles some chords, and
      // "A" or "Am" can be a syllable.)
      const found = chords.filter(Boolean).length

      if (nearerBelow) {
        if (below[0] > 8 * unit(below[1]) || found < Math.min(2, line.length)) continue
        // Rehearsal letters match too, but are set in another size than the chords.
        const sizes = line.filter((t, i) => chords[i]).map((t) => t.h).sort((a, b) => a - b)
        const size = sizes[sizes.length >> 1]
        line.forEach((t, i) => {
          if (!chords[i] || !anchors.length || Math.abs(t.h - size) > 0.12 * size) return
          const { anchor, offset } = under(anchors, t.x, unit(below[1]))
          anchor.el.parentNode.insertBefore(harmony(doc, chords[i], offset), anchor.el)
          added.chords++
        })
      } else if (above[0] < 10 * unit(above[1]) && found < 0.5 * line.length) {
        // Other programs write several words as one piece of text: place each by its share.
        const words = line
          .flatMap((t) => {
            let at = 0
            return t.str.split(/ |(?<=\p{L}[-‐])(?=\p{L})/u).map((str) => {  // "Danc-ing" is two syllables
              const word = { ...t, str, x: t.x + (t.w * at) / t.str.length, w: (t.w * str.length) / t.str.length }
              at += str.length + 1
              return word
            })
          })
          .filter((t) => t.str && !/^[\d.,()]+$/.test(t.str))
        if (words.filter((t) => !/^[-‐–—_]+$/.test(t.str)).length < 3) continue
        const verse = (verses.get(above[1]) ?? 0) + 1
        verses.set(above[1], verse)
        const free = (byStaff.get(`${page}/${above[1]}`) ?? []).filter((a) => a.pitched)
        const reach = 3 * unit(above[1])
        let joined = false // the syllable before ended in a hyphen
        for (let i = 0; i < words.length; i++) {
          const raw = words[i].str
          if (/^[-‐]+$/.test(raw)) { joined = true; continue }
          if (/^[–—_]+$/.test(raw)) continue // a line which extends a syllable
          const syllable = raw.replace(/^[-‐]+|[-‐–—_]+$/g, '')
          const next = words[i + 1]?.str ?? ''
          const joins = /[-‐]$/.test(raw) || /^[-‐]/.test(next)
          const centre = words[i].x + words[i].w / 2
          const note = free.reduce((best, a) => (!best || Math.abs(a.x - centre) < Math.abs(best.x - centre) ? a : best), null)
          if (syllable && note && Math.abs(note.x - centre) < reach) {
            free.splice(free.indexOf(note), 1)
            const lyric = note.el.appendChild(element(doc, 'lyric', null, { number: verse }))
            lyric.append(element(doc, 'syllabic', joined ? (joins ? 'middle' : 'end') : joins ? 'begin' : 'single'), element(doc, 'text', syllable))
            added.lyrics++
          }
          joined = joins
        }
      }
    }
  })
  return added
}
