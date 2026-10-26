import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// BASE lets the same build live at "/" or under a sub-path (e.g. GitHub Pages "/MagicEngine/").
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
});
