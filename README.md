# Sheetscan

Turn scanned sheet music — PDFs, scans, phone photos — into an editable score, in the
browser. Check the result against the original, play it back, fix what was misread, and
download MusicXML (Finale, Sibelius, capella, MuseScore, Dorico) or MIDI.

Everything runs on your device: the music is not uploaded anywhere. The first scan
downloads the recognition models (about 150 MB), which the browser keeps.

**Use it:** https://dsalex1.github.io/sheetscan/ — needs a current Chrome, Edge or Firefox
(WebAssembly JSPI).

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
- **Text** — title, composer, lyrics and chord symbols — is taken from the PDF's text
  layer and placed by position (`web/src/annotate.js`).
- **Display, playback and MIDI** use [Verovio](https://www.verovio.org); PDFs are
  rendered with [pdf.js](https://mozilla.github.io/pdf.js/).

## How well it works

`bench/` scores a reading against the notation file the page was printed from: both
become lists of (onset in the measure, pitch) and are aligned measure by measure
(`bench/evalscore.py`). The note F1 below counts a note as right only if both its
pitch and its place in the measure are right; pitch F1 ignores rhythm. The same PDFs
were read with capella-scan 8 for comparison. Seven private scores (28 pages, PDFs
printed from their Finale files) and one public one:

| score | notes | Sheetscan: note F1 (pitch F1) | capella-scan 8: note F1 (pitch F1) |
|---|---|---|---|
| flute solo, triplets throughout (2 p.) | 466 | 0.90 (1.00) | 0.18 (0.74) |
| piano piece with single-staff verses (2 p.) | 281 | 1.00 (1.00) | 0.80 (0.87) |
| string part with chord symbols, staves that come and go (2 p.) | 353 | 0.93 (0.96) | 0.88 (0.95) |
| lead sheet with rhythm slashes (2 p.) | 278 | 0.87 (0.87) | 0.83 (0.91) |
| piano piece in octave clefs, mixed metres (4 p.) | 1380 | 0.97 (0.99) | 0.80 (0.81) |
| piano solo (7 p.) | 1641 | 0.99 (0.99) | 0.97 (0.99) |
| voice and piano with lyrics (9 p.) | 1905 | 0.93 (0.95) | not comparable¹ |
| Bach chorale BWV 66.6, four staves (1 p., `bench/sample/`) | 163 | 1.00 (1.00) | not run |

¹ The capella-scan export for this score held 526 of the 1905 notes; its recognition
may have been cut short when it was saved, so the figure (0.32) is not a fair one.

PHOTOSCAN

Known limits: drum notation and tablature are not read; lyrics and chord symbols need a
PDF with a text layer (photos give notes only); repeats and voltas are kept, but
ornaments and articulations only in part.

## Develop

```sh
pip install homr && homr --init          # the engine and its models
cd web
python tools/pack_assets.py              # copies them into web/public
npm install
npm run dev                              # http://localhost:5173
npm run deploy                           # build and push to the gh-pages branch
```

Benchmark: put material in `~/.omrbench` as described in `bench/run_all.py`, then
`python bench/run_all.py [--variant photo|scan]`.

## Licence

AGPL-3.0, as homr's code and model weights are. Note homr's own
[licence FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md): part of the
models' training data (Camera-PrIMuS) is licensed for non-commercial use.
