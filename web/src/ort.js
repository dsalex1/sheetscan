// The three recognition networks on onnxruntime-web, behind the two calls the Python side
// needs (see py/ort_shim.py). Used inside the recognition worker where the browser has
// WebAssembly JSPI, and in a worker of its own (ort.worker.js) where it has not.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
const MODELS = ['segnet', 'encoder', 'decoder']

// Memory is what decides whether a phone can do this at all, so a model is only in
// memory while it is at work: segmentation first, then the transformer (encoder and
// decoder), never both. Their files stay in the browser's Cache API.
let ort
let base
const sessions = {}
const kept = new Map() // outputs which stay here: the decoder's cache, fed back in each step

/** Have `url` in the Cache API (downloading it once, with byte progress) and return it. */
export async function cached(url, onBytes = () => {}) {
  const cache = await caches.open('omr-assets-v1')
  if (!(await cache.match(url))) {
    const res = await fetch(url)
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
    await cache.put(url, new Response(new Blob(chunks)))
  }
  return (await cache.match(url)).arrayBuffer()
}

/** Download the models from `from` (once). onProgress(bytes done, bytes in all). */
export async function load(from, onProgress) {
  base = from
  ort = await import(/* @vite-ignore */ ORT + 'ort.wasm.min.mjs')
  ort.env.wasm.wasmPaths = ORT
  // Threads need shared memory.
  ort.env.wasm.numThreads = typeof SharedArrayBuffer === 'function' ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1
  const progress = {}
  for (const name of MODELS)
    await cached(`${base}models/${name}.onnx`, (got) => {
      progress[name] = got
      onProgress(Object.values(progress).reduce((sum, bytes) => sum + bytes, 0), 150e6) // about 150 MB in all
    })
}

/** The session for the model file homr asks for, started if need be - and the others stopped. */
async function session(path) {
  const name = MODELS.find((model) => path.includes(model))
  if (!sessions[name]) {
    for (const other of MODELS.filter((model) => (model === 'segnet') !== (name === 'segnet')))
      if (sessions[other]) {
        await (await sessions[other]).release()
        delete sessions[other]
        kept.clear()
      }
    // WASM with threads; the WebGPU provider was tried and stalled while starting.
    sessions[name] = cached(`${base}models/${name}.onnx`).then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
  }
  return sessions[name]
}

/** Input and output names of the model stored at `path` (as homr names its files). */
export const names = async (path) => {
  const { inputNames, outputNames } = await session(path)
  return { inputs: inputNames, outputs: outputNames }
}

/**
 * Run a model. feeds: {input: {type, dims, data} | {keep: name of an output kept earlier}}.
 * Returns {output: {type, dims, data}} for the wanted outputs, except "cache_out" ones,
 * which are kept here under their name.
 */
export async function run(path, feeds, wanted) {
  const inputs = {}
  for (const [name, feed] of Object.entries(feeds))
    inputs[name] = feed.keep ? kept.get(`${path}/${feed.keep}`) : new ort.Tensor(feed.type, feed.data, feed.dims)
  const results = await (await session(path)).run(inputs)
  const out = {}
  for (const name of wanted) {
    if (name.startsWith('cache_out')) kept.set(`${path}/${name}`, results[name])
    else out[name] = { type: results[name].type, dims: results[name].dims, data: results[name].data }
  }
  return out
}
