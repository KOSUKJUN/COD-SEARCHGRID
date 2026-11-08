import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

const mockApi = process.env.MOCK_API_URL ?? 'http://localhost:3001'
const usePolling = process.env.VITE_USE_POLLING === 'true'

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    command === 'build' &&
      dts({
        tsconfigPath: './tsconfig.build.json',
        entryRoot: 'src',
      }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: mockApi, changeOrigin: true },
    },
    // Docker(Windows bind mount) 에서는 파일 변경 이벤트가 전달되지 않으므로 polling 사용
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'CodSearchGrid',
      fileName: 'cod-searchgrid',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        exports: 'named',
        globals: { vue: 'Vue' },
      },
    },
    sourcemap: true,
  },
}))
