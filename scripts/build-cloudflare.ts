import { spawnSync } from 'node:child_process';
// Reuse the same static build, with the party API served by the same Worker.
const result = spawnSync(process.execPath, [process.env.npm_execpath!, 'run', 'build'], {
  stdio: 'inherit', env: { ...process.env, PUBLIC_PARTY_API_URL: '/api' },
});
process.exit(result.status ?? 1);
