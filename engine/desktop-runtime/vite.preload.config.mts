import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/runtime/preload',
    emptyOutDir: true,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: ['electron']
    }
  }
});
