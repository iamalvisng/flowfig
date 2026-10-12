import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the gallery. `npm run build` bundles src/element.ts over the tsc output.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/element.ts', formats: ['es'], fileName: 'element' },
    outDir: 'dist',
    emptyOutDir: false,
    minify: true,
  },
});
