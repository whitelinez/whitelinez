import { defineConfig } from 'vite'
import path from 'path'

const root = path.resolve(process.cwd(), 'public')

export default defineConfig({
  root,
  publicDir: false,   // no nested public/ inside public/
  server: {
    port: 3000,
    proxy: {
      // Forward all /api calls to production — keeps local dev working with real data
      '/api': {
        target: 'https://aitrafficja.com',
        changeOrigin: true,
        secure: true,
      },
      // Vercel Analytics script — not served locally, return empty to suppress 404
      '/_vercel/insights': {
        target: 'https://aitrafficja.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: path.resolve(process.cwd(), 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_debugger: true,
        pure_funcs: ['console.debug'],
        passes: 2,
      },
      mangle: {
        toplevel: true,   // safe now that all JS uses ES modules
        eval: false,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        main:    path.resolve(root, 'index.html'),
        admin:   path.resolve(root, 'admin.html'),
        account: path.resolve(root, 'account.html'),
      },
    },
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
  },
})
