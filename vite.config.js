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
    
    // Chunk size threshold
    chunkSizeWarningLimit: 1000,
    
    // Rollup options for better bundling
    rollupOptions: {
      output: {
        // Keep primary assets on stable URLs to avoid stale HTML pointing to deleted files after deploy.
        entryFileNames: "js/app.js",
        chunkFileNames: "js/chunk-[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return "css/app[extname]";
          }
          return "assets/[name][extname]";
        }
      }
    }
  }
});
