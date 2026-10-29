import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { antiSpoiler } from './build/anti-spoiler'

export default defineConfig({
  plugins: [react(), antiSpoiler()],
  base: './',
  build: {
    sourcemap: false,
    emptyOutDir: true,
  },
})
