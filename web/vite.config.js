import { defineConfig } from 'vite'

// Cross-origin isolation lets onnxruntime-web use threads (several times faster).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
})
