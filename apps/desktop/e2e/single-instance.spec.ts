import { spawn } from 'node:child_process';
import { appUnderTest, expect, test } from './fixtures';

// FR-012: only one instance uses the user's data at a time; a second launch hands over to the first and exits.

test('a second launch on the same data exits and leaves one window', async ({ session }) => {
  const { app, page } = await session.launch();
  const { executablePath, args } = appUnderTest();
  const env = { ...process.env } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const second = spawn(executablePath, [...args, `--user-data-dir=${session.userDataDir}`], { env, stdio: 'ignore' });
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('the second instance did not exit'));
    }, 20_000);
    second.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).toBe(0);

  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
