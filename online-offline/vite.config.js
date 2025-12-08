import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), basicSsl()],
  server: {
    // HTTPS is required for MediaRecorder when accessing via IP address (not localhost)
    // The basicSsl plugin handles certificate generation automatically
    // No need to specify https here - the plugin enables it
    port: 5173,
    // Bind to all network interfaces (0.0.0.0) to allow access via IP address
    host: '0.0.0.0',
    // Strict port - don't try other ports if 5173 is taken
    strictPort: true,
  },
});
