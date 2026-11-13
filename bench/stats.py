"""Per-part overview of scores: stats.py <score>..."""
import sys

from music21 import converter

for path in sys.argv[1:]:
    score = converter.parse(path)
    print(path)
    for part in score.parts:
        ms = part.getElementsByClass("Measure")
        notes = sum(len(n.pitches) for n in part.recurse().notes)
        print(f"  part {part.partName!r}: {len(ms)} measures, {notes} noteheads")
