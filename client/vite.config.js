import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4320,
    proxy: {
      '/api': 'http://localhost:4310',
      '/auth': 'http://localhost:4310',
    },
  },
});
