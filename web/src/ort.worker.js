// The networks in a worker of their own, for browsers without WebAssembly JSPI (Safari
// before 27, so every browser on older iPhones and iPads). Python cannot wait for a
// promise there; instead the recognition worker blocks on shared memory (Atomics.wait)
// until this worker has written its answer into it. See callSync in omr.worker.js.
// The page starts both workers and hands each one end of a message channel (WebKit
// refuses a worker started from inside a worker on a cross-origin isolated page).
import { load, names, run } from './ort.js'

let flag // Int32Array [done, length of the JSON header]
let bytes // Uint8Array: the header at 0, tensor data from DATA on
const DATA = 1 << 16

function answer(header) {
  const json = new TextEncoder().encode(JSON.stringify(header))
  bytes.set(json)
  Atomics.store(flag, 1, json.length)
  Atomics.store(flag, 0, 1)
  Atomics.notify(flag, 0)
}

self.onmessage = ({ data: { port } }) => (port.onmessage = ({ data }) => handle(data, port))

async function handle(data, port) {
  if (data.op === 'load') {
    flag = new Int32Array(data.shared, 0, 2)
    bytes = new Uint8Array(data.shared, 8)
    try {
      await load(data.base, (done, total) => port.postMessage({ done, total }))
      port.postMessage({ loaded: true })
    } catch (e) {
      port.postMessage({ failed: String(e?.message ?? e) })
    }
    return
  }
  try {
    if (data.op === 'names') return answer(await names(data.path))
    const out = await run(data.path, data.feeds, data.wanted)
    let at = DATA
    for (const tensor of Object.values(out)) {
      const raw = new Uint8Array(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength)
      if (at + raw.length > bytes.length) throw new Error('result too large for the shared buffer')
      bytes.set(raw, at)
      Object.assign(tensor, { data: undefined, at, length: raw.length })
      at += raw.length + (-raw.length & 7) // keep 8-byte alignment
    }
    answer(out)
  } catch (e) {
    answer({ error: String(e?.message ?? e) })
  }
}
