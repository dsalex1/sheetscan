# Sheetscan

Turn scanned sheet music — PDFs, scans, phone photos — into an editable score, in the
browser. Check the result against the original, play it back, fix what was misread, and
download MusicXML (Finale, Sibelius, capella, MuseScore, Dorico) or MIDI.

Everything runs on your device: the music is not uploaded anywhere. The first scan
downloads the recognition models (about 150 MB), which the browser keeps.

**Use it:** https://dsalex1.github.io/sheetscan/ — in a current Chrome, Edge, Firefox or
Safari, on a computer, iPad or iPhone (iOS 16.4 or later).

## How it works

- **Recognition** is [homr](https://github.com/liebharc/homr) (staff detection + a
  transformer that reads each staff), run unchanged as Python inside
  [Pyodide](https://pyodide.org). Its neural networks run through
  [onnxruntime-web](https://onnxruntime.ai); `web/src/py/ort_shim.py` stands in for the
  `onnxruntime` package.
- `web/src/py/pipeline.py` drives homr page by page and adds what it lacks:
  octave clefs (the small 8 under a clef), systems told apart by their joining line,
  a repair of misread tuplets by measure length, and note ids which record where on the
  page each note was read.
- **Text** — title, composer, tempo marks, lyrics and chord symbols — comes from the
  PDF's text layer, or from OCR ([Tesseract](https://tesseract.projectnaptha.com)) for
  scans and photos, and is placed by position (`web/src/annotate.js`). Accidentals are
  marked by the usual rule (key signature, earlier accidentals in the measure), as homr
  only says how each note sounds.
- homr calls the networks like plain functions, onnxruntime-web answers with promises.
  Where the browser has WebAssembly JSPI, Python simply waits; where it has not (Safari
  before 27), the networks run in a second worker and Python blocks on shared memory
  until the answer is there (`web/src/omr.worker.js`).
- **Display, playback and MIDI** use [Verovio](https://www.verovio.org); PDFs are
  rendered with [pdf.js](https://mozilla.github.io/pdf.js/).

## How well it works

`bench/` scores a reading against the notation file the page was printed from: both
become lists of (onset in the measure, pitch) and are aligned measure by measure
(`bench/evalscore.py`). The note F1 below counts a note as right only if both its
pitch and its place in the measure are right; pitch F1 ignores rhythm. The same PDFs
were read with capella-scan 8 for comparison. Seven private scores (28 pages, PDFs
printed from their Finale files) and one public one. "Photo" and "scan" are the same
pages run through `bench/degrade.py` (a sheet on a desk shot at an angle: perspective,
uneven light, blur, noise, JPEG; a crooked 150-dpi copier grey). Note F1, in brackets
pitch F1:

| score | notes | Sheetscan | as photo | as scan | capella-scan 8 |
|---|---|---|---|---|---|
| flute solo, triplets throughout (2 p.) | 466 | 0.90 (1.00) | 0.87 (1.00) | 0.88 (1.00) | 0.18 (0.74) |
| piano piece with single-staff verses (2 p.) | 281 | 1.00 (1.00) | 0.94 (1.00) | 0.95 (1.00) | 0.80 (0.87) |
| string part with chords, staves that come and go (2 p.) | 353 | 0.93 (0.96) | 0.95 (0.99) | 0.94 (0.99) | 0.88 (0.95) |
| lead sheet with rhythm slashes (2 p.) | 278 | 0.87 (0.87) | 0.88 (0.88) | 0.87 (0.87) | 0.83 (0.91) |
| piano piece in octave clefs, mixed metres (4 p.) | 1380 | 0.97 (0.99) | 0.93 (0.98) | 0.92 (0.95) | 0.80 (0.81) |
| piano solo (7 p.) | 1641 | 0.99 (0.99) | 0.99 (0.99) | 0.99 (0.99) | 0.97 (0.99) |
| voice and piano with lyrics (9 p.) | 1905 | 0.93 (0.95) | 0.92 (0.95) | 0.93 (0.95) | 0.60 (0.78) |
| **all seven, weighted by notes** | 6304 | **0.95** | **0.94** | **0.94** | **0.74** |
| Bach chorale BWV 66.6, four staves (1 p., `bench/sample/`) | 163 | 1.00 (1.00) | | | not run |

Known limits: drum notation and tablature are not read; rhythm slashes come out as
notes; on scans and photos the text is read by OCR, which gets most lyrics but only part
of the chord symbols (and no flats); ornaments and articulations are kept only in part.
A page takes about half a minute on a desktop computer, the first one a minute more.

Every reading is also checked against the official MusicXML 4.0 schema
(`bench/validate.py`, the "schema" column of `bench/run_all.py`): Finale refuses files
which break it, and homr's own output does (the pipeline puts the elements into schema
order). An export with lyrics was imported into Finale 27 to confirm.

`web/tools/browser-test.mjs` scans the sample page in a real browser engine and compares
the result note for note with the native reading. It passes on the deployed site in
Chromium and in WebKit (the engine of Safari and of every browser on iOS), there both
with JSPI and with the shared-memory bridge. Not yet tried on an actual iPhone or iPad,
where memory is the open question.

## Develop

```sh
pip install homr && homr --init          # the engine and its models
cd web
python tools/pack_assets.py              # copies them into web/public
npm install
npm run dev                              # http://localhost:5173
npm run deploy                           # build and push to the gh-pages branch
node tools/browser-test.mjs webkit       # after: npx playwright install webkit
```

Benchmark: put material in `~/.omrbench` as described in `bench/run_all.py`, then
`python bench/run_all.py [--variant photo|scan]`.

## Licence

AGPL-3.0, as homr's code and model weights are. Note homr's own
[licence FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md): part of the
models' training data (Camera-PrIMuS) is licensed for non-commercial use.
