import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/element.ts', formats: ['es'], fileName: 'element' },
    outDir: 'dist',
    emptyOutDir: false,
    minify: true,
  },
});
