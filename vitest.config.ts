import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    // Windows process startup is costly under load. Keep each suite isolated without spawning a Node process per file.
    pool: process.platform === 'win32' ? 'threads' : 'forks',
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    isolate: true,
    fsModuleCache: process.platform === 'win32',
  },
});
