import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Identifica cada início do servidor da interface. A página carregada guarda o seu; se o servidor responder outro,
 * o sistema foi atualizado e a página aberta é antiga: a interface pede para recarregar.
 */
const BUILD_ID = String(Date.now());
const buildId = (): Plugin => ({
  name: 'build-id',
  configureServer(server) {
    server.middlewares.use('/__build', (_request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.setHeader('cache-control', 'no-store');
      response.end(BUILD_ID);
    });
  },
});

// A API é servida na mesma origem via proxy, para o cookie de sessão SameSite=Strict (ADR-003).
export default defineConfig({
  plugins: [tailwindcss(), react(), buildId()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
});
