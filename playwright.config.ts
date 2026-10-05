import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const browser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: { executablePath: browser, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
