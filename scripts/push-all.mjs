// Pushes every actor (or the named ones) to the Apify platform. Requires `npx apify login` first.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const wanted = process.argv.slice(2);
const actors = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.actor/actor.json')))
    .map((d) => d.name).filter((n) => wanted.length === 0 || wanted.includes(n));
for (const name of actors) {
    console.log(`\n=== apify push ${name}`);
    const r = spawnSync('npx', ['apify', 'push', '--no-prompt'], { cwd: join(root, name), stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status);
}
