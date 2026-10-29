import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Absolute site URL for canonical / Open Graph tags (social scrapers need absolute image URLs).
// Set SITE_URL to use a custom domain; on Vercel it falls back to the production domain.
function siteUrl() {
  const explicit = process.env.SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = explicit || (vercel ? `https://${vercel}` : '');
  return url.replace(/\/+$/, '');
}

export default defineConfig(({ command }) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'lirika-site-url',
        transformIndexHtml: (html: string) => html.replaceAll('__SITE_URL__', command === 'build' ? siteUrl() : ''),
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
