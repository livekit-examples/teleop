// Start local trials by default; --modal opts in to the deployed API.
// The Python launcher uses dev:web for Next.js, without calling this entry point again.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const launcher = fileURLToPath(new URL('../../scripts/demo-local.py', import.meta.url));
const child = spawn('python3', [launcher, ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(`Could not start development server: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
