"""Check MusicXML files against the official MusicXML 4.0 schema: validate.py <file>...

Finale refuses files which break the schema (other programs shrug), so every reading
must pass. The schema is fetched once into ~/.omrbench/xsd. Needs lxml.
"""
import pathlib
import sys
import urllib.request

from lxml import etree

XSD = pathlib.Path.home() / ".omrbench" / "xsd"
SOURCE = "https://raw.githubusercontent.com/w3c/musicxml/gh-pages/schema/"


def schema():
    XSD.mkdir(parents=True, exist_ok=True)
    for name in ("musicxml.xsd", "xlink.xsd", "xml.xsd"):
        if not (XSD / name).exists():
            urllib.request.urlretrieve(SOURCE + name, XSD / name)
    # The schema names its two helper schemas by web address; point it at the copies here.
    text = (XSD / "musicxml.xsd").read_bytes().replace(b"http://www.musicxml.org/xsd/", b"")
    return etree.XMLSchema(etree.fromstring(text, base_url=(XSD / "musicxml.xsd").as_uri()))


def errors(path, xsd):
    """Distinct schema errors of a file, most frequent first: [(count, message)]."""
    xsd.validate(etree.parse(str(path)))
    counts = {}
    for error in xsd.error_log:
        counts[error.message] = counts.get(error.message, 0) + 1
    return sorted(((n, m) for m, n in counts.items()), reverse=True)


if __name__ == "__main__":
    xsd = schema()
    failed = False
    for path in sys.argv[1:]:
        found = errors(path, xsd)
        failed |= bool(found)
        print(f"{'FAIL' if found else 'ok  '} {path}")
        for count, message in found[:12]:
            print(f"     {count:>4}x {message[:200]}")
    sys.exit(failed)
