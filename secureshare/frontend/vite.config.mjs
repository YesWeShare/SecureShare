import { copyFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = resolve(frontendDirectory, '../..');
const sourceDirectory = resolve(workspaceRoot, 'src');
const stylesheet = resolve(workspaceRoot, 'css/style.css');
const outputDirectory = resolve(frontendDirectory, 'dist');

export default defineConfig({
  root: sourceDirectory,
  publicDir: false,
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': 'http://localhost:3000' },
    fs: { allow: [workspaceRoot] },
  },
  resolve: {
    alias: [
      { find: '@serenity-kit/opaque', replacement: resolve(frontendDirectory, 'node_modules/@serenity-kit/opaque/esm/index.js') },
      { find: '@zxing/browser', replacement: resolve(frontendDirectory, 'node_modules/@zxing/browser/esm/index.js') },
      { find: 'qrcode', replacement: resolve(frontendDirectory, 'node_modules/qrcode/lib/browser.js') },
    ],
  },
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    rollupOptions: { input: [resolve(sourceDirectory, 'index.html'), resolve(sourceDirectory, 'share.html')] },
  },
  plugins: [{
    name: 'secureshare-local-routes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? '/';
        const pathname = new URL(requestUrl, 'http://localhost').pathname;
        if (pathname === '/share' || /^\/receive\/[0-9a-f-]{36}\/?$/iu.test(pathname)) {
          request.url = `/share.html${new URL(requestUrl, 'http://localhost').search}`;
        }
        if (request.url !== '/css/style.css') return next();
        response.setHeader('Content-Type', 'text/css; charset=utf-8');
        createReadStream(stylesheet).pipe(response);
      });
    },
    closeBundle() {
      mkdirSync(resolve(outputDirectory, 'css'), { recursive: true });
      copyFileSync(stylesheet, resolve(outputDirectory, 'css/style.css'));
      mkdirSync(resolve(outputDirectory, 'share'), { recursive: true });
      copyFileSync(resolve(outputDirectory, 'share.html'), resolve(outputDirectory, 'share/index.html'));
      mkdirSync(resolve(outputDirectory, 'receive'), { recursive: true });
      copyFileSync(resolve(outputDirectory, 'share.html'), resolve(outputDirectory, 'receive/index.html'));
      writeFileSync(
        resolve(outputDirectory, '_redirects'),
        '/share /share/index.html 200\n/receive/* /receive/index.html 200\n',
      );
    },
  }],
});