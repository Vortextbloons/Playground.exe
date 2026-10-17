import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
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
