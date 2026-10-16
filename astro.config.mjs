import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  base: process.env.BASE_PATH || '/',
  output: 'static', trailingSlash: 'always', integrations: [svelte()],
});
