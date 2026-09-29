import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/64px-portrait-studio/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 8089,
    host: '0.0.0.0'
  }
});
