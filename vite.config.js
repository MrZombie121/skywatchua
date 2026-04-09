import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  build: {
    // Use esbuild for minification (default, very fast)
    minify: "esbuild",
    
    // Target modern browsers for better compression
    target: "es2020",
    
    // Report compressed size
    reportCompressedSize: true,
    
    // Chunk size threshold (warn if larger)
    chunkSizeWarningLimit: 1000,
    
    // Rollup options for better bundling
    rollupOptions: {
      output: {
        // Manual chunking for better caching
        manualChunks: {
          // Separate large libraries into their own chunks
          leaflet: ['leaflet'],
          vendor: ['dotenv']
        },
        // Preload critical chunks
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return 'css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
