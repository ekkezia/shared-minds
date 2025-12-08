import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,
    port: 5173, // change if you run on another port
    cors: true,
    // allow all hostnames (use only for dev/testing), or set to an array with your ngrok host.
    allowedHosts: 'all',
    // set origin to the public ngrok URL (used by the client to construct HMR URLs)
    origin: 'https://inviolate-subgranular-arie.ngrok-free.dev',
    // HMR config forces the client to connect to the proxied host via wss
    hmr: {
      protocol: 'wss',
      host: 'inviolate-subgranular-arie.ngrok-free.dev',
      port: 443,
    },
  },
});
