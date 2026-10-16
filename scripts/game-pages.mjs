import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Astro's dev route guard sees games/<id>/game.html at the project root
// and rejects HTML navigation before Vite can serve public/games/<id>/game.html.
// Serve only generated game entrypoints; leave all other paths to Astro.
export function gamePages() {
  return {
    name: 'playground:game-pages',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      const publicDir = server.config.publicDir;
      const base = server.config.base;
      return () => {
        server.middlewares.stack.unshift({ route: '', handle: async (req, res, next) => {
          if (!publicDir || !['GET', 'HEAD'].includes(req.method ?? '')) return next();
          // Keep Astro's cross-site request checks in charge of foreign embeds.
          if (req.headers['sec-fetch-site'] === 'cross-site') return next();
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          if (!pathname.startsWith(base)) return next();
          const match = /^games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/game\.html$/.exec(pathname.slice(base.length));
          if (!match) return next();
          try {
            const html = await readFile(resolve(publicDir, 'games', match[1], 'game.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : html);
          } catch (error) {
            if (error.code === 'ENOENT') return next();
            next(error);
          }
        } });
      };
    },
  };
}
