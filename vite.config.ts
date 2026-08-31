import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from file:// inside a Capacitor WebView.
  base: './',
  server: { host: true, port: Number(process.env.PORT) || 5173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
});
