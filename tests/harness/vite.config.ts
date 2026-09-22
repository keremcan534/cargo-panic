/**
 * Dev server config for the Canvas 2D harness tests only: no hot reload and
 * no file watching, so a page under test is never reloaded because the test
 * run itself wrote screenshots or traces into the project folder.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  root: process.cwd(),
  server: { hmr: false, watch: null },
});
