// Text on pages which have no text layer (scans, photos), for title, lyrics and chord
// symbols. Tesseract loads on first use: its code and language data come from the CDN.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js'

let worker

async function start() {
  const tesseract = await import(/* @vite-ignore */ TESSERACT)
  const made = await (tesseract.default ?? tesseract).createWorker(['eng', 'deu'])
  // "Sparse text": words scattered over the page. The default layout analysis looks for
  // columns of prose and loses most of the text between staves.
  await made.setParameters({ tessedit_pageseg_mode: '11' })
  return made
}

let last = Promise.resolve()

/** Words on a page image as the tokens annotate.js takes: [{str, x, y, h, w}]. */
export function ocr(page) {
  return (last = last.catch(() => {}).then(() => read(page))) // the worker takes one page at a time
}

async function read(page) {
  const { data } = await (await (worker ??= start())).recognize(page.url, {}, { blocks: true })
  return (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    // Notes and beams come out as low-confidence scraps; hyphens between syllables matter.
    .filter((word) => word.confidence > 55 && /\p{L}|^-+$/u.test(word.text))
    .map(({ text, bbox }) => ({ str: text, x: bbox.x0, w: bbox.x1 - bbox.x0, y: bbox.y1, h: bbox.y1 - bbox.y0 }))
}
