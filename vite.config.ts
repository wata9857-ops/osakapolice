import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works on GitHub Pages under /<repo>/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
