var e=Object.defineProperty,t=/* @__PURE__ */ ((t,n)=>{let r={};for(var i in t)e(r,i,{get:t[i],enumerable:!0});return n||e(r,Symbol.toStringTag,{value:`Module`}),r})({cached:()=>s,load:()=>c,names:()=>u,run:()=>d});const n=`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/`,r=[`segnet`,`encoder`,`decoder`];let i;const a={},o=/* @__PURE__ */ new Map;async function s(e,t=()=>{}){let n=await caches.open(`omr-assets-v1`),r=await n.match(e);if(!r){if(r=await fetch(e),!r.ok)throw Error(`${e}: HTTP ${r.status}`);let i=+r.headers.get(`content-length`)||0,a=r.body.getReader(),o=[];for(let e=0;;){let{done:n,value:r}=await a.read();if(n)break;o.push(r),t(e+=r.length,i)}let s=new Blob(o);return await n.put(e,new Response(s)),s.arrayBuffer()}return r.arrayBuffer()}async function c(e,t){i=await import(
/* @vite-ignore */
n+`ort.wasm.min.mjs`),i.env.wasm.wasmPaths=n,i.env.wasm.numThreads=typeof SharedArrayBuffer==`function`?Math.min(navigator.hardwareConcurrency||4,8):1;let o={};await Promise.all(r.map(async n=>{let r=await s(`${e}models/${n}.onnx`,(e,r)=>{o[n]=[e,r];let i=e=>Object.values(o).reduce((t,n)=>t+n[e],0);t(i(0),i(1))});a[n]=await i.InferenceSession.create(r,{executionProviders:[`wasm`]})}))}const l=e=>a[r.find(t=>e.includes(t))],u=e=>({inputs:l(e).inputNames,outputs:l(e).outputNames});async function d(e,t,n){let r={};for(let[n,a]of Object.entries(t))r[n]=a.keep?o.get(`${e}/${a.keep}`):new i.Tensor(a.type,a.data,a.dims);let a=await l(e).run(r),s={};for(let t of n)t.startsWith(`cache_out`)?o.set(`${e}/${t}`,a[t]):s[t]={type:a[t].type,dims:a[t].dims,data:a[t].data};return s}var f=`"""Stand-in for the \`onnxruntime\` package inside Pyodide: forwards to onnxruntime-web.

Only the surface homr uses. The JavaScript side (ort.js) offers ortNames(path) and
ortRun(path, feeds, wanted); it answers with a promise where WebAssembly JSPI lets
Python wait for one, and at once where the call blocks instead (see omr.worker.js).
Outputs named "cache_out..." stay on the JavaScript side (the decoder's cache, which
Python only hands back in the next step); an OrtValue for one is just its name.
"""
import js
import numpy as np
from pyodide.ffi import run_sync, to_js


def _call(answer):
    return run_sync(answer) if hasattr(answer, "then") else answer


class OrtValue:
    def __init__(self, array=None, kept=None):
        self.array, self.kept = array, kept

    @staticmethod
    def ortvalue_from_numpy(a, *_):
        return OrtValue(np.ascontiguousarray(a))

    def numpy(self):
        return self.array


class _Named:
    def __init__(self, name):
        self.name = name


class _IOBinding:
    def __init__(self):
        self.feeds, self.wanted, self.outputs = {}, [], []

    def bind_cpu_input(self, name, a):
        self.feeds[name] = OrtValue(np.ascontiguousarray(a))

    def bind_ortvalue_input(self, name, value):
        self.feeds[name] = value

    def bind_output(self, name, *_):
        if name not in self.wanted:
            self.wanted.append(name)

    def get_outputs(self):
        return self.outputs


class InferenceSession:
    def __init__(self, path, providers=None, **_):
        self.path = str(path)
        names = _call(js.ortNames(self.path))
        self.inputs, self.outputs = list(names.inputs), list(names.outputs)

    def get_inputs(self):
        return [_Named(n) for n in self.inputs]

    def get_outputs(self):
        return [_Named(n) for n in self.outputs]

    def get_providers(self):
        return ["CPUExecutionProvider"]

    def io_binding(self):
        return _IOBinding()

    def run_with_iobinding(self, iobinding):
        feeds = {
            name: {"keep": value.kept} if value.kept else
            {"type": str(value.array.dtype), "dims": list(value.array.shape), "data": value.array.ravel()}
            for name, value in iobinding.feeds.items()
        }
        to_object = js.Object.fromEntries
        result = _call(js.ortRun(self.path, to_js(feeds, dict_converter=to_object), to_js(iobinding.wanted)))
        iobinding.outputs = [
            OrtValue(kept=name) if name.startswith("cache_out") else OrtValue(_array(getattr(result, name)))
            for name in iobinding.wanted
        ]


def _array(tensor):
    return np.asarray(tensor.data.to_py()).reshape(list(tensor.dims))


def get_available_providers():
    return ["CPUExecutionProvider"]


def set_default_logger_severity(_):
    pass


def preload_dlls():
    pass
`,p=`"""Sheet-music pages -> MusicXML. Runs unchanged natively (bench) and in Pyodide (browser).\r
\r
Recognition is homr (staff detection + transformer); this module drives it page by\r
page and adds what homr lacks: octave clefs.\r
"""\r
import itertools\r
import json\r
import os\r
import sys\r
import tempfile\r
import types\r
import xml.etree.ElementTree as ET\r
\r
import cv2\r
import numpy as np\r
\r
# homr imports these at module level but only uses them for downloads, PDF\r
# rendering and title OCR, none of which this pipeline calls.\r
for _name, _attrs in (("requests", {}), ("pypdfium2", {}), ("rapidocr", {"RapidOCR": None})):\r
    try:\r
        __import__(_name)\r
    except ImportError:\r
        _mod = types.ModuleType(_name)\r
        _mod.__dict__.update(_attrs)\r
        sys.modules[_name] = _mod\r
\r
from homr import main as homr_main  # noqa: E402\r
from homr import music_xml_generator, staff_parsing  # noqa: E402\r
from homr.main import ProcessingConfig, detect_staffs_in_image  # noqa: E402\r
from homr.model import MultiStaff  # noqa: E402\r
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402\r
from homr.relieur import process_concat  # noqa: E402\r
from homr.system_repair import repair_systems  # noqa: E402\r
from homr.transformer import vocabulary  # noqa: E402\r
from homr.transformer.configs import Config  # noqa: E402\r
from homr.triplet_restoration import _as_triplet  # noqa: E402\r
\r
_CONFIG = ProcessingConfig(\r
    enable_debug=False, enable_cache=False, write_staff_positions=False,\r
    read_staff_positions=False, selected_staff=-1, transformer_use_gpu=False,\r
    segnet_use_gpu=False, coreml_encoder=False, title_detection=False,\r
)\r
_TRANSFORMER = Config()\r
_TRANSFORMER.use_gpu_inference = False\r
_TRANSFORMER.use_coreml_encoder = False\r
\r
\r
def _ink(region):\r
    """Mask (0/255) of what is printed in a piece of the page. The cut is nearer to the\r
    paper than to the darkest ink, so that thin strokes a scanner turned grey still count."""\r
    if region.size == 0:\r
        return np.zeros((1, 1), np.uint8)\r
    paper, darkest = float(np.median(region)), float(region.min())\r
    if paper - darkest < 40:  # nothing printed here\r
        return np.zeros(region.shape, np.uint8)\r
    return (region < paper - 0.3 * (paper - darkest)).astype(np.uint8) * 255\r
\r
\r
def _has_eight_below(image, x0, x1, lines, limit, bass):\r
    """Is there a small "8" under a clef (an octave clef)? lines are the staff's five\r
    line positions there. An 8 is the only glyph with two small holes, one above the\r
    other. It may touch the clef or the bottom line, so look for the holes, not the\r
    glyph. Under a bass clef the 8 straddles the bottom line; a treble clef has loops\r
    of its own there, and its 8 hangs below the tail."""\r
    unit, bottom = (lines[4] - lines[0]) / 4, lines[4]\r
    y0, y1 = int(bottom - (1.2 if bass else 0.3) * unit), int(min(bottom + 5 * unit, limit))\r
    ink = _ink(image[y0:y1, max(int(x0), 0) : int(x1)])\r
    contours, hierarchy = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)\r
    if hierarchy is None:\r
        return False\r
    holes = [cv2.boundingRect(c) for c, h in zip(contours, hierarchy[0]) if h[3] != -1]\r
    holes = [\r
        (bx + w / 2, by + h / 2)\r
        for bx, by, w, h in holes  # wider holes are half notes cut by a ledger line\r
        if 0.15 * unit <= w <= 0.65 * unit and 0.15 * unit <= h <= 0.65 * unit\r
    ]\r
    return any(\r
        abs(ax - bx) < 0.25 * unit and 0.2 * unit < by - ay < 1.1 * unit\r
        for ax, ay in holes\r
        for bx, by in holes\r
    )\r
\r
\r
def _has_pitch(symbol):\r
    """A note the transformer gave a pitch like "C4" (now and then it gives none)."""\r
    return symbol.rhythm.startswith("note") and symbol.pitch[:1] in tuple("CDEFGAB") and symbol.pitch[1:].isdigit()\r
\r
\r
def _staff_name(symbol):\r
    return "lower" if symbol.position.startswith("lower") else "upper"\r
\r
\r
def _mark_octave_clefs(image, staff, symbols, carried):\r
    """Renames clefs with an 8 below to clef_.._8vb and lowers the notes they govern.\r
    The first clef of a staff sits at its start; a later one (a clef change) is looked\r
    for around where the transformer saw it. \`carried\` is how the line above ended,\r
    {staff name: (lowered, clef sign)}: a line starts as the last one ended, so an 8\r
    which is missed there is still known. Returns the same for this line."""\r
    state, started = dict(carried), set()\r
    for symbol in symbols:\r
        name = _staff_name(symbol)\r
        if symbol.rhythm.startswith(("note", "rest")):\r
            started.add(name)\r
            if state.get(name, (False,))[0] and _has_pitch(symbol):\r
                symbol.pitch = symbol.pitch[:-1] + str(int(symbol.pitch[-1]) - 1)\r
        elif symbol.rhythm.startswith("clef"):\r
            sign = symbol.rhythm.split("_")[1][0]\r
            change = name in started and symbol.image_coordinates\r
            point = staff.get_at(symbol.image_coordinates[0]) if change else staff.grid[0]\r
            k = 5 if name == "lower" else 0\r
            if point is None or len(point.y) < k + 5:\r
                continue\r
            lines = point.y[k : k + 5]\r
            unit = (lines[4] - lines[0]) / 4\r
            x = symbol.image_coordinates[0] if change else point.x + 1.5 * unit\r
            limit = point.y[5] - unit if k == 0 and len(point.y) > 5 else image.shape[0]\r
            found = _has_eight_below(image, x - 2.5 * unit, x + 2.5 * unit, lines, limit, sign == "F")\r
            lowered = found or (name not in started and carried.get(name) == (True, sign))\r
            state[name] = (lowered, sign)\r
            if lowered:\r
                symbol.rhythm += "_8vb"\r
    return state\r
\r
\r
_parse_staff_image = staff_parsing.parse_staff_image\r
_build_clef = music_xml_generator.build_clef\r
_line_above = None  # (top of the staff, how its octave clefs ended) of the last staff read\r
\r
\r
def _parse_staff_image_with_octave_clefs(debug, index, staff, image, *args, **kwargs):\r
    # (Placing notes far from the staff by their notehead blob instead of the transformer's\r
    # count of ledger lines was tried here: no gain, chord heads run together.)\r
    global _line_above\r
    symbols = _parse_staff_image(debug, index, staff, image, *args, **kwargs)\r
    # homr reads a part line by line down the page, then starts the next part at the top.\r
    carried = _line_above[1] if _line_above and _line_above[0] < staff.min_y else {}\r
    _line_above = (staff.min_y, _mark_octave_clefs(image, staff, symbols, carried))\r
    return symbols\r
\r
\r
def _build_clef_with_octave(model_clef, attributes):\r
    _build_clef(model_clef, attributes)\r
    if model_clef.rhythm.endswith("_8vb"):\r
        ET.SubElement(attributes.findall("clef")[-1], "clef-octave-change").text = "-1"\r
\r
\r
def _step(chord):\r
    """The notes and rests which decide how long a chord lasts (its shortest), and that length."""\r
    timed = [s for s in chord if s.rhythm.startswith(("note", "rest")) and s.get_duration().fraction > 0]\r
    if not timed:\r
        return [], 0\r
    shortest = min(s.get_duration().fraction for s in timed)\r
    return [s for s in timed if s.get_duration().fraction == shortest], shortest\r
\r
\r
def _fit_measure(measure, typical):\r
    """Bring a measure to the usual length by the fewest changes between plain and tuplet\r
    note values; if no such change fits exactly, it is left as read.\r
    Too long: a plain value next to tuplets is part of the tuplet (a quarter under a\r
    triplet bracket). Too short: tuplets which are none.\r
    (Also demanding that tuplet groups fill whole beats was tried and read worse.)"""\r
    total = vocabulary._get_duration_of_measure(measure)\r
    if not typical or total == typical:\r
        return measure\r
    steps = [shortest for shortest, length in map(_step, measure) if length]\r
    tuplets = [n for n, shortest in enumerate(steps) if any(s.is_tuplet() for s in shortest)]\r
    if total > typical:\r
        change = _as_triplet\r
        candidates = [\r
            n for n, shortest in enumerate(steps)\r
            if n not in tuplets and any(abs(n - t) <= 2 for t in tuplets)\r
            and all(change(s) is not s for s in shortest)\r
        ]\r
    else:\r
        change = lambda s: s.remove_tuplet()  # noqa: E731\r
        candidates = tuplets\r
    for size in range(1, min(len(candidates), 6) + 1):\r
        for chosen in itertools.combinations(candidates[:12], size):\r
            swap = {id(s): change(s) for n in chosen for s in steps[n]}\r
            trial = [[swap.get(id(s), s) for s in chord] for chord in measure]\r
            if vocabulary._get_duration_of_measure(trial) == typical:\r
                return trial\r
    return measure\r
\r
\r
def _repair_tuplets(chords):\r
    """Stands in for homr's _fix_over_eager_tuplets, which strips every tuplet from any\r
    measure shorter than the usual one - ruinous for music that is full of them."""\r
    measures = vocabulary._group_into_measures(chords)\r
    typical = vocabulary._get_typical_duration_of_measures(measures)\r
    return vocabulary._flatten_measures([_fit_measure(m, typical) for m in measures])\r
\r
\r
vocabulary._fix_over_eager_tuplets = _repair_tuplets\r
\r
_page = 0  # index of the page being read, for note ids\r
_notes = 0\r
\r
\r
def _build_note_id(note, symbol):\r
    """Gives every note an id which says where it was seen: n<count>-p<page>-<x>-<y>,\r
    in pixels of the page image. The editor uses it to show a note's place on the scan."""\r
    global _notes\r
    _notes += 1\r
    at = symbol.image_coordinates\r
    where = f"-p{_page}-{max(round(at[0]), 0)}-{max(round(at[1]), 0)}" if at else ""\r
    note.set("id", f"n{_notes}{where}")\r
\r
\r
# homr segments a page eight tiles at a time; two at a time need far less memory at once\r
# (which phones lack) and are as fast on a CPU.\r
_extract = homr_main.extract\r
homr_main.extract = lambda *args, **kwargs: _extract(*args, batch_size=2, **kwargs)\r
\r
# homr has no hooks; its functions look these up as module globals on every call.\r
staff_parsing.parse_staff_image = _parse_staff_image_with_octave_clefs\r
music_xml_generator.build_clef = _build_clef_with_octave\r
music_xml_generator.build_image_position = _build_note_id\r
\r
\r
def _are_joined(image, upper, lower):\r
    """Do two staves belong to one system? Then a line joins them at their left end."""\r
    a, b = upper.grid[0], lower.grid[0]\r
    unit = (a.y[4] - a.y[0]) / 4\r
    x = int(max(a.x, b.x))\r
    gap = image[int(a.y[-1] + unit / 2) : int(b.y[0] - unit / 2), max(int(x - 1.5 * unit), 0) : int(x + 1.5 * unit)]\r
    return gap.size > 0 and _ink(gap).any(axis=1).mean() > 0.95\r
\r
\r
def _split_unjoined_systems(image, rows):\r
    """homr guesses which staves form a system from the layout of the page, and e.g.\r
    takes a piano system followed by a single-staff line for a system of two parts\r
    sounding together. Keep only what the system line confirms."""\r
    result = []\r
    for row in rows:\r
        group = [row.staffs[0]]\r
        for staff in row.staffs[1:]:\r
            if _are_joined(image, group[-1], staff):\r
                group.append(staff)\r
            else:\r
                result.append(MultiStaff(group, []))\r
                group = [staff]\r
        result.append(row if len(group) == len(row.staffs) else MultiStaff(group, []))\r
    return result\r
\r
\r
def _staff_boxes(rows, to_input):\r
    """Where the staves are, for placing text found on the page: one\r
    [left, top line, right, bottom line, system index] per staff, in page-image pixels."""\r
    boxes = []\r
    for system, row in enumerate(rows):\r
        for staff in row.staffs:\r
            first, last = staff.grid[0], staff.grid[-1]\r
            for k in range(0, len(first.y) - 4, 5):\r
                left, top = to_input((first.x, first.y[k]))\r
                right, bottom = to_input((last.x, first.y[k + 4]))\r
                boxes.append([round(left), round(top), round(right), round(bottom), system])\r
    return boxes\r
\r
\r
def _read_page(path):\r
    """One page image -> (MusicXML <score-partwise> element, staff boxes)."""\r
    global _line_above\r
    _line_above = None\r
    rows, image, debug, _, _, to_input = detect_staffs_in_image(path, _CONFIG)\r
    try:\r
        rows = _split_unjoined_systems(image, repair_systems(debug, rows))\r
        voices = staff_parsing.parse_staffs(debug, rows, image, config=_TRANSFORMER)\r
    finally:\r
        debug.clean_debug_files_from_previous_runs()\r
    for symbol in (s for voice in voices for s in voice):\r
        if symbol.image_coordinates:  # so far in the resized page homr works on\r
            symbol.image_coordinates = to_input(symbol.image_coordinates)\r
    xml = music_xml_generator.generate_xml(XmlGeneratorArguments(False, None, None), voices, "")\r
    return xml, _staff_boxes(rows, to_input)\r
\r
\r
# The MusicXML schema fixes the order of children; homr writes some out of it (voice\r
# after type, alter after octave, clef before key). Most programs don't mind, Finale\r
# refuses the file. bench/validate.py checks the result against the schema.\r
_CHILD_ORDER = {\r
    "note": "grace cue chord pitch unpitched rest duration tie instrument footnote level voice type dot "\r
            "accidental time-modification stem notehead notehead-text staff beam notations lyric play listen",\r
    "pitch": "step alter octave",\r
    "attributes": "footnote level divisions key time staves part-symbol instruments clef staff-details "\r
                  "transpose for-part directive measure-style",\r
}\r
\r
\r
def _order_children(score):\r
    for tag, order in _CHILD_ORDER.items():\r
        rank = {name: i for i, name in enumerate(order.split())}\r
        for element in score.iter(tag):\r
            element[:] = sorted(element, key=lambda child: rank.get(child.tag, len(rank)))  # stable\r
\r
\r
def _give_every_staff_a_clef(score):\r
    """A staff that is silent at first (a piece opening on single-staff lines before the\r
    piano enters) gets its first clef only where it starts: put that clef at the beginning."""\r
    for part in score.findall("part"):\r
        first = part.find("measure/attributes")\r
        if first is None:\r
            continue\r
        have = {clef.get("number", "1") for clef in first.findall("clef")}\r
        for clef in part.iter("clef"):\r
            number = clef.get("number", "1")\r
            if number not in have:\r
                have.add(number)\r
                copy = ET.fromstring(ET.tostring(clef))\r
                last = first.findall("clef")\r
                first.insert(list(first).index(last[-1]) + 1 if last else len(first), copy)\r
\r
\r
def scan(paths, progress=lambda done, total: None):\r
    """Recognise each page image; pages without music are skipped. Returns MusicXML text.\r
    The staff boxes of every page ride along as the miscellaneous field "staff-layout"."""\r
    global _page\r
    with tempfile.TemporaryDirectory() as tmp:\r
        xmls, layout = [], [[] for _ in paths]\r
        for _page, path in enumerate(paths):\r
            progress(_page, len(paths))\r
            try:\r
                xml, layout[_page] = _read_page(path)\r
            except Exception as e:  # e.g. a title page: "No staffs found"\r
                print(f"page {_page + 1} skipped: {e}", file=sys.stderr)\r
                continue\r
            xmls.append(os.path.join(tmp, f"{_page}.musicxml"))\r
            ET.ElementTree(xml).write(xmls[-1], encoding="unicode", xml_declaration=True)\r
        progress(len(paths), len(paths))\r
        if not xmls:\r
            raise ValueError("No music found on any page")\r
        merged = process_concat(xmls)[0] if len(xmls) > 1 else ET.parse(xmls[0]).getroot()\r
        _give_every_staff_a_clef(merged)\r
        _order_children(merged)\r
        field = ET.SubElement(ET.SubElement(merged.find("identification"), "miscellaneous"), "miscellaneous-field")\r
        field.set("name", "staff-layout")\r
        field.text = json.dumps(layout)\r
        return ET.tostring(merged, encoding="unicode", xml_declaration=True)\r
`;const m=`https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`,h=new URL(`..`,``+import.meta.url).href,g={float32:Float32Array,int64:BigInt64Array,uint8:Uint8Array,int32:Int32Array,bool:Uint8Array},_=(e,t={})=>self.postMessage({type:e,...t}),v=(e,t)=>_(`status`,{text:`Downloading recognition models (once)…`,done:e,total:t});async function y(e){if(typeof SharedArrayBuffer!=`function`)throw Error(`This browser gave the page no shared memory, which the recogniser needs here. Reload the page once; if that does not help, use a current Chrome, Edge or Firefox.`);let t=new SharedArrayBuffer(33554440),n=new Int32Array(t,0,2),r=new Uint8Array(t,8);await new Promise((n,r)=>{e.onmessage=({data:e})=>e.loaded?n():e.failed?r(Error(e.failed)):v(e.done,e.total),e.postMessage({op:`load`,base:h,shared:t})});let i=t=>{Atomics.store(n,0,0),e.postMessage(t),Atomics.wait(n,0,0);let i=JSON.parse(new TextDecoder().decode(r.slice(0,n[1])));if(i.error)throw Error(i.error);return i};return{names:e=>i({op:`names`,path:e}),run(e,t,n){let a=i({op:`run`,path:e,feeds:t,wanted:n});for(let e of Object.values(a))e.data=new g[e.type](r.slice(e.at,e.at+e.length).buffer);return a}}}let b;function x(e){return b??=(async()=>{let n=!e;_(`status`,{text:`Loading Python runtime…`});let{loadPyodide:r}=await import(
/* @vite-ignore */
m+`pyodide.mjs`),i=n?c(h,v).then(()=>t):y(e);i.catch(()=>{});let a=await r({indexURL:m,stderr:e=>_(`log`,{text:e})});_(`status`,{text:`Loading image libraries…`}),await a.loadPackage([`numpy`,`opencv-python`,`pillow`,`typing-extensions`]),a.unpackArchive(await s(`${h}homr.zip`),`zip`,{extractDir:`/lib/python3.14/site-packages`}),a.FS.writeFile(`/lib/python3.14/site-packages/onnxruntime.py`,f),a.FS.writeFile(`/lib/python3.14/site-packages/pipeline.py`,p),a.FS.mkdirTree(`/work`),_(`status`,{text:`Starting recognition engine…`});let o=a.runPython(`import pipeline; pipeline.scan`),{names:l,run:u}=await i;return Object.assign(self,{ortNames:l,ortRun:u}),{pyodide:a,scan:o,jspi:n}})()}self.onmessage=async({data:e})=>{try{let{pyodide:t,scan:n,jspi:r}=await x(e.port),i=e.pages.map((e,n)=>{let r=`/work/p${n+1}.png`;return t.FS.writeFile(r,new Uint8Array(e)),r}),a=(e,t)=>_(`status`,{text:`Reading page ${Math.min(e+1,t)} of ${t}…`,done:e,total:t}),o=r?await n.callPromising(t.toPy(i),a):n(t.toPy(i),a);_(`result`,{xml:o,bridge:r?`jspi`:`shared memory`})}catch(e){_(`error`,{text:String(e?.message??e)})}};