import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    // Dev-only: send the bare dev URL to the game entry.
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
  // The HTML entry is `game.html`, never `index.html`: Astro's dev server
  // reserves `/index.html` paths for routing and refuses to serve public ones.
  build: { rollupOptions: { input: `${import.meta.dirname}/game.html` } },
});
