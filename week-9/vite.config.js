import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // Allow all hosts
    port: 8000,
    strictPort: false,
    allowedHosts: ['inviolate-subgranular-arie.ngrok-free.dev'],
    hmr: {
      clientPort: 443
    }
  }
});
