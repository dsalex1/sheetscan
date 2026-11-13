// Recognition worker: homr (Python, in Pyodide) driving onnxruntime-web.
//
// homr calls the networks like ordinary functions, but onnxruntime-web answers with
// promises. Two ways to bridge that:
//  - WebAssembly JSPI lets Python wait for a promise: the networks run right here.
//  - Without JSPI (Safari before 27) they run in a second worker (ort.worker.js), reached
//    through a port the page hands over, and this one blocks on shared memory until the
//    answer is there. That needs a cross-origin isolated page.
import * as networks from './ort.js'
import ortShim from './py/ort_shim.py?raw'
import pipeline from './py/pipeline.py?raw'

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'
const BASE = new URL('..', import.meta.url).href // this file is served one folder below the app
const SHARED = 32 << 20 // room for the largest answer: a batch of segmentation maps
const ARRAYS = { float32: Float32Array, int64: BigInt64Array, uint8: Uint8Array, int32: Int32Array, bool: Uint8Array }

const post = (type, data = {}) => self.postMessage({ type, ...data })
const downloading = (done, total) => post('status', { text: 'Downloading recognition models (once)…', done, total })

/** Start the networks in the worker behind `port`; returns names() and run() which block for the answer. */
async function startBlockingBridge(port) {
  if (typeof SharedArrayBuffer !== 'function')
    throw new Error('This browser gave the page no shared memory, which the recogniser needs here. Reload the page once; if that does not help, use a current Chrome, Edge or Firefox.')
  const shared = new SharedArrayBuffer(8 + SHARED)
  const flag = new Int32Array(shared, 0, 2) // [answer is there, length of its JSON header]
  const bytes = new Uint8Array(shared, 8)
  await new Promise((resolve, reject) => {
    port.onmessage = ({ data }) => (data.loaded ? resolve() : data.failed ? reject(new Error(data.failed)) : downloading(data.done, data.total))
    port.postMessage({ op: 'load', base: BASE, shared })
  })
  const callSync = (message) => {
    Atomics.store(flag, 0, 0)
    port.postMessage(message)
    Atomics.wait(flag, 0, 0)
    const answer = JSON.parse(new TextDecoder().decode(bytes.slice(0, flag[1])))
    if (answer.error) throw new Error(answer.error)
    return answer
  }
  return {
    names: (path) => callSync({ op: 'names', path }),
    run(path, feeds, wanted) {
      const out = callSync({ op: 'run', path, feeds, wanted })
      for (const tensor of Object.values(out)) tensor.data = new ARRAYS[tensor.type](bytes.slice(tensor.at, tensor.at + tensor.length).buffer)
      return out
    },
  }
}

let ready
function init(port) {
  return (ready ??= (async () => {
    const jspi = !port
    post('status', { text: 'Loading Python runtime…' })
    const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE + 'pyodide.mjs')
    // The networks download while Python boots.
    const bridge = jspi ? networks.load(BASE, downloading).then(() => networks) : startBlockingBridge(port)
    bridge.catch(() => {}) // reported below, when awaited

    const pyodide = await loadPyodide({ indexURL: PYODIDE, stderr: (text) => post('log', { text }) })
    post('status', { text: 'Loading image libraries…' })
    await pyodide.loadPackage(['numpy', 'opencv-python', 'pillow', 'typing-extensions'])
    pyodide.unpackArchive(await networks.cached(`${BASE}homr.zip`), 'zip', { extractDir: '/lib/python3.14/site-packages' })
    pyodide.FS.writeFile('/lib/python3.14/site-packages/onnxruntime.py', ortShim)
    pyodide.FS.writeFile('/lib/python3.14/site-packages/pipeline.py', pipeline)
    pyodide.FS.mkdirTree('/work')
    post('status', { text: 'Starting recognition engine…' })
    const scan = pyodide.runPython('import pipeline; pipeline.scan')
    const { names, run } = await bridge
    Object.assign(self, { ortNames: names, ortRun: run })
    return { pyodide, scan, jspi }
  })())
}

self.onmessage = async ({ data }) => {
  try {
    const { pyodide, scan, jspi } = await init(data.port)
    const paths = data.pages.map((bytes, i) => {
      const path = `/work/p${i + 1}.png`
      pyodide.FS.writeFile(path, new Uint8Array(bytes))
      return path
    })
    const onPage = (done, total) => post('status', { text: `Reading page ${Math.min(done + 1, total)} of ${total}…`, done, total })
    const xml = jspi ? await scan.callPromising(pyodide.toPy(paths), onPage) : scan(pyodide.toPy(paths), onPage)
    post('result', { xml, bridge: jspi ? 'jspi' : 'shared memory' })
  } catch (e) {
    post('error', { text: String(e?.message ?? e) })
  }
}
