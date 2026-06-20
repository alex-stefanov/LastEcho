import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    host: true,
    // Forward API calls to the FastAPI server so the browser sees same-origin
    // requests (no CORS needed in dev).
    proxy: { '/api': 'http://localhost:8000' },
  },
  // Ensure a single three instance (globe.gl + three-globe must share it).
  resolve: { dedupe: ['three'] },
  // Build straight into the OpenKBS static-site dir (./site), which
  // `openkbs site deploy` ships to S3 + CloudFront.
  build: { outDir: '../site', emptyOutDir: true },
});
