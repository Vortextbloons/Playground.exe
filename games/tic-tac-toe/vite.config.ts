import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    tailwindcss(),
    {
      name: 'game-entry-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(302, { location: '/game.html' });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  build: { rollupOptions: { input: `${import.meta.dirname}/game.html` } },
});