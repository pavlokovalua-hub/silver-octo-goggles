import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for building the web component (library mode)
// Usage: npx vite build --config vite.lib.config.js
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/virtual-try-on-element.jsx',
      name: 'VirtualTryOn',
      formats: ['iife'],
      fileName: () => 'virtual-try-on.js',
    },
    rollupOptions: {
      // Bundle React inside the widget (self-contained)
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
