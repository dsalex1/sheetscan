"""Render PDFs to page PNGs: render.py <out_dir> <pdf>... -> out_dir/<stem>/p<N>.png"""
import sys, pathlib, fitz

out = pathlib.Path(sys.argv[1])
for pdf in sys.argv[2:]:
    p = pathlib.Path(pdf)
    d = out / p.stem.strip().replace(" ", "_")
    d.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(p)
    for i, page in enumerate(doc, 1):
        page.get_pixmap(dpi=200).save(d / f"p{i}.png")
    print(d, len(doc), "pages")
