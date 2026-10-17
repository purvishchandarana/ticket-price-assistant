// `npm run dev`: API server, Vite UI and the demo site together, with
// prefixed output. Ctrl+C stops all three.

import { spawn } from 'node:child_process';

const TASKS = [
  { name: 'api ', color: 35, args: ['run', 'dev', '-w', 'server'] },
  { name: 'ui  ', color: 36, args: ['run', 'dev', '-w', 'client'] },
  { name: 'demo', color: 33, args: ['run', 'dev', '-w', 'demo-site'] },
];

const children = TASKS.map(({ name, color, args }) => {
  // A single command string (args are fixed literals) works with npm.cmd on Windows.
  const child = spawn(`npm ${args.join(' ')}`, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => process.stdout.write(`${prefix}exited (${code ?? 'signal'})\n`));
  return child;
});

console.log('\n  UI:        http://127.0.0.1:5173\n  API:       http://127.0.0.1:3001\n  Demo site: http://127.0.0.1:4100\n');

const stopAll = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
