// Recognition worker: homr (Python, in Pyodide) driving onnxruntime-web.
import ortShim from './py/ort_shim.py?raw'
import pipeline from './py/pipeline.py?raw'

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
const BASE = new URL('..', import.meta.url).href // this file is served one folder below the app
const MODELS = ['segnet', 'encoder', 'decoder']

const post = (type, data = {}) => self.postMessage({ type, ...data })

/** Fetch with byte progress, kept in the Cache API so models download once. */
async function cached(url, onBytes) {
  const cache = await caches.open('omr-assets-v1')
  let res = await cache.match(url)
  if (!res) {
    res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const total = +res.headers.get('content-length') || 0
    const reader = res.body.getReader()
    const chunks = []
    for (let got = 0; ;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      onBytes((got += value.length), total)
    }
    const blob = new Blob(chunks)
    await cache.put(url, new Response(blob))
    return blob.arrayBuffer()
  }
  return res.arrayBuffer()
}

let ready
function init() {
  return (ready ??= (async () => {
    if (typeof WebAssembly.Suspending !== 'function')
      throw new Error('This browser lacks WebAssembly JSPI. Please use a current Chrome, Edge or Firefox.')
    post('status', { text: 'Loading Python runtime…' })
    const [{ loadPyodide }, ort] = await Promise.all([
      import(/* @vite-ignore */ PYODIDE + 'pyodide.mjs'),
      import(/* @vite-ignore */ ORT + 'ort.wasm.min.mjs'),
    ])
    ort.env.wasm.wasmPaths = ORT
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1

    const sessions = {}
    const progress = {}
    const loadModel = (name) =>
      (sessions[name] ??= cached(`${BASE}models/${name}.onnx`, (got, total) => {
        progress[name] = [got, total]
        const all = Object.values(progress)
        const sum = (i) => all.reduce((s, p) => s + p[i], 0)
        post('status', { text: 'Downloading recognition models (once)…', done: sum(0), total: sum(1) })
        // WASM with threads; the WebGPU provider was tried and stalled while starting.
      }).then((buf) => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })))
    MODELS.forEach(loadModel) // start downloads while Python boots

    self.ort = ort
    self.ortSession = (path) => loadModel(MODELS.find((m) => path.includes(m)))

    const pyodide = await loadPyodide({ indexURL: PYODIDE, stderr: (text) => post('log', { text }) })
    post('status', { text: 'Loading image libraries…' })
    await pyodide.loadPackage(['numpy', 'opencv-python', 'pillow', 'typing-extensions'])
    pyodide.unpackArchive(await cached(`${BASE}homr.zip`, () => {}), 'zip', { extractDir: '/lib/python3.14/site-packages' })
    pyodide.FS.writeFile('/lib/python3.14/site-packages/onnxruntime.py', ortShim)
    pyodide.FS.writeFile('/lib/python3.14/site-packages/pipeline.py', pipeline)
    pyodide.FS.mkdirTree('/work')
    post('status', { text: 'Starting recognition engine…' })
    const scan = pyodide.runPython('import pipeline; pipeline.scan')
    await Promise.all(MODELS.map(loadModel))
    return { pyodide, scan }
  })())
}

self.onmessage = async ({ data }) => {
  try {
    const { pyodide, scan } = await init()
    if (data.type !== 'scan') return post('ready')
    const paths = data.pages.map((bytes, i) => {
      const path = `/work/p${i + 1}.png`
      pyodide.FS.writeFile(path, new Uint8Array(bytes))
      return path
    })
    const onPage = (done, total) => post('status', { text: `Reading page ${Math.min(done + 1, total)} of ${total}…`, done, total })
    const xml = await scan.callPromising(pyodide.toPy(paths), onPage)
    post('result', { xml })
  } catch (e) {
    post('error', { text: String(e?.message ?? e) })
  }
}
