import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: process.env.PORT ? parseInt(process.env.PORT) : 5173, host: true },
  // Ensure a single three instance (globe.gl + three-globe must share it).
  resolve: { dedupe: ['three'] },
});
