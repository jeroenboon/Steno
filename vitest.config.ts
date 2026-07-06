import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'out', 'dist'],
    coverage: {
      provider: 'v8',
      // Print a summary to the job log; no HTML/report artifacts, no threshold
      // gate (audit Q1: thresholds invite gaming — visibility first).
      reporter: ['text-summary', 'text'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Tests and test infrastructure
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test-setup.ts',
        // Type-only declarations
        'src/**/*.d.ts',
        // Local-only, gitignored preview harness (excluded from the DoD gate)
        'src/renderer/src/preview.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
})
