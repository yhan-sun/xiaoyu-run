import { defineConfig } from "vite";

// Tauri 在固定端口起前端 dev server；clearScreen 关掉以免盖住 Rust 编译输出。
export default defineConfig({
  root: ".",
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari15",
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
