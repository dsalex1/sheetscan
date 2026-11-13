import { defineConfig } from 'vite'

// Cross-origin isolation lets onnxruntime-web use threads (several times faster).
// The resource policy is what coi-serviceworker adds on the deployed site; without it
// WebKit refuses a module that a second worker imports.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
})
