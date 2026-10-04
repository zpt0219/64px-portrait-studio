/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/64px-portrait-studio/',
  server: {
    port: 8089,
    host: '0.0.0.0'
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**']
  }
});

