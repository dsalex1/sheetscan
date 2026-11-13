"""MIDI-level similarity of two scores: evalscore.py <truth.mxl> <omr.musicxml> [...more pairs]

Each score becomes a list of measures; a measure is a multiset of
(onset-in-measure, midi pitch) over all parts, ties merged, graces dropped.
Measures are aligned with Needleman-Wunsch so a missed barline costs one measure,
not the rest of the piece. Reports note F1 (onset+pitch) and pitch-only F1.
"""
import sys
from collections import Counter
from fractions import Fraction

from music21 import converter, harmony


def measures(path):
    score = converter.parse(path)
    out = {}
    for part in score.parts:
        for i, m in enumerate(part.stripTies().getElementsByClass("Measure")):
            c = out.setdefault(i, Counter())
            for n in m.recurse().notes:
                # Only what a reader of the printed page can know: no graces, no hidden
                # notes, no rhythm slashes (they show no pitch).
                if n.duration.isGrace or n.style.hideObjectOnPrint:
                    continue
                if getattr(n, "notehead", None) == "slash" or isinstance(n, harmony.Harmony):
                    continue  # music21 lists chord symbols among the notes
                onset = Fraction(n.getOffsetInHierarchy(m)).limit_denominator(48)
                for p in n.pitches:
                    c[(onset, p.midi)] += 1
    return [out[i] for i in sorted(out)]


def overlap(a, b):
    return sum((a & b).values())


def pitches(c):
    r = Counter()
    for (_, p), n in c.items():
        r[p] += n
    return r


def align(truth, omr, sim):
    n, m = len(truth), len(omr)
    best = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best[i][j] = max(
                best[i - 1][j], best[i][j - 1], best[i - 1][j - 1] + sim(truth[i - 1], omr[j - 1])
            )
    return best[n][m]


def diff(truth_path, omr_path, limit=15):
    """Print the first mismatching measures: notes missing from / extra in the OMR result."""
    from music21 import pitch

    t, o = measures(truth_path), measures(omr_path)
    n, m = len(t), len(o)
    best = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best[i][j] = max(best[i - 1][j], best[i][j - 1], best[i - 1][j - 1] + overlap(t[i - 1], o[j - 1]))
    pairs, i, j = [], n, m
    while i and j:
        if best[i][j] == best[i - 1][j - 1] + overlap(t[i - 1], o[j - 1]):
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif best[i][j] == best[i - 1][j]:
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    show = lambda c: " ".join(f"{float(on):g}:{pitch.Pitch(p).nameWithOctave}" for (on, p), k in sorted(c.items()) for _ in range(k))
    for i, j in reversed(pairs):
        a, b = (t[i] if i is not None else Counter()), (o[j] if j is not None else Counter())
        if a != b and limit:
            limit -= 1
            print(f"truth m{None if i is None else i + 1} / omr m{None if j is None else j + 1}")
            print(f"   missing: {show(a - b)}\n   extra:   {show(b - a)}")


def f1(matched, n_truth, n_omr):
    return 2 * matched / (n_truth + n_omr) if n_truth + n_omr else 1.0


def compare(truth_path, omr_path):
    t, o = measures(truth_path), measures(omr_path)
    nt, no = sum(sum(c.values()) for c in t), sum(sum(c.values()) for c in o)
    note = align(t, o, overlap)
    pitch = align([pitches(c) for c in t], [pitches(c) for c in o], overlap)
    return {
        "truth_notes": nt, "omr_notes": no, "truth_measures": len(t), "omr_measures": len(o),
        "note_f1": round(f1(note, nt, no), 4), "pitch_f1": round(f1(pitch, nt, no), 4),
    }


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--diff"]
    for truth, omr in zip(args[::2], args[1::2]):
        print(omr, compare(truth, omr))
        if "--diff" in sys.argv:
            diff(truth, omr)
