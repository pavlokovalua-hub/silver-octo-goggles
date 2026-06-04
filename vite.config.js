import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const hasCertificates = fs.existsSync('key.pem') && fs.existsSync('cert.pem');

export default defineConfig({
  plugins: [react()],
  base: '/silver-octo-goggles/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: hasCertificates ? {
      key: fs.readFileSync(path.resolve(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, 'cert.pem')),
    } : false,
  },
})
