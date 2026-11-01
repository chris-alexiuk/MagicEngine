import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * mana-font's stylesheet declares its fonts in four legacy formats and also ships an MPlantin font we don't use.
 * Strip those @font-face rules so the build bundles only the Mana woff2 (declared in styles/base.css), self-hosted:
 * the hosted copy can't load a CDN stylesheet.
 */
function manaFontCss(): Plugin {
  return {
    name: 'mana-font-css',
    enforce: 'pre',
    transform(code, id) {
      if (/mana-font[\\/]css[\\/]mana(\.min)?\.css/.test(id)) return { code: code.replace(/@font-face\s*\{[^}]*\}/g, ''), map: null };
      return null;
    },
  };
}

// BASE lets the same build live at "/" or under a sub-path (e.g. GitHub Pages "/MagicEngine/").
export default defineConfig({
  base: process.env.BASE ?? '/',
  resolve: { alias: { '~mana': fileURLToPath(new URL('./node_modules/mana-font', import.meta.url)) } },
  plugins: [manaFontCss(), react()],
});
