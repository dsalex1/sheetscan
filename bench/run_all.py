"""Benchmark: our pipeline vs capella-scan, both scored against ground truth.

    python bench/run_all.py [--force] [--variant photo|scan] [name...]

Test material (private scores) lives outside the repo in ~/.omrbench:
    scores.json              {"name": "truth file in gt/", ...}
    gt/<truth>               MusicXML exported from the notation program (truth)
    gt/<name>.pdf            PDF exported from the same file
    pages/<name>/pN.png      that PDF rendered at 200 dpi (bench/render.py)
    pages_photo|scan/...     degraded copies of those pages (bench/degrade.py)
    gt/<name>_capscan.xml    capella-scan 8's reading of the PDF (baseline)
    out[_variant]/<name>.musicxml   our reading (cached; --force re-runs recognition)

"schema" says whether our reading passes the MusicXML 4.0 schema (bench/validate.py).
"""
import json
import pathlib
import sys
import warnings

warnings.filterwarnings("ignore")
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "web" / "src" / "py"))

from evalscore import compare  # noqa: E402
from validate import errors, schema  # noqa: E402

BENCH = pathlib.Path.home() / ".omrbench"
SCORES = json.loads((BENCH / "scores.json").read_text(encoding="utf-8"))


def ours(name, suffix, force):
    out = BENCH / f"out{suffix}" / f"{name}.musicxml"
    if force or not out.exists():
        import pipeline

        pages = sorted((BENCH / f"pages{suffix}" / name).glob("p*.png"), key=lambda p: int(p.stem[1:]))
        out.parent.mkdir(exist_ok=True)
        out.write_text(pipeline.scan([str(p) for p in pages]), encoding="utf-8")
    return out


def cell(truth, result):
    if not result.exists():
        return f"{'-':>6} {'-':>6} {'-':>6}"
    r = compare(truth, result)
    return f"{r['omr_notes']:>6} {r['note_f1']:>6.3f} {r['pitch_f1']:>6.3f}"


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    suffix = f"_{args[args.index('--variant') + 1]}" if "--variant" in args else ""
    names = [a for a in args if a in SCORES]
    head = f"{'notes':>6} {'note':>6} {'pitch':>6}"
    xsd = schema()
    print(f"{'score':<11}{'truth':>6} | ours{suffix or '      '}: {head} schema | capella-scan: {head}")
    for name in names or SCORES:
        truth = BENCH / "gt" / SCORES[name]
        reading = ours(name, suffix, force)
        valid = "INVALID" if errors(reading, xsd) else "ok"
        n = compare(truth, truth)["truth_notes"]
        print(f"{name:<11}{n:>6} |             {cell(truth, reading)} {valid:>6} |               "
              f"{cell(truth, BENCH / 'gt' / f'{name}_capscan.xml')}", flush=True)
