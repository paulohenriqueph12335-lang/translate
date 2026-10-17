import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A API é servida na mesma origem via proxy, para o cookie de sessão SameSite=Strict (ADR-003).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
});
