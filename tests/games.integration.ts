import assert from 'node:assert/strict';
import { discoverGames } from '../src/data/games';

const endpoint = process.env.GAME_TEST_URL ?? 'http://localhost:4321';
for (const game of await discoverGames()) {
  const response = await fetch(`${endpoint}/games/${game.id}/game.html`, {
    headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(response.status, 200, `${game.id}: browser iframe navigation must succeed`);
  const html = await response.text();
  assert.match(html, /<script[^>]+src=/);
  for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/assets\/[^" ]+)"/g)) {
    const result = await fetch(new URL(asset!, response.url));
    assert.equal(result.status, 200, `${game.id}: ${asset}`);
  }
  console.log(`PASS ${game.id}: browser HTML request and generated assets`);
}
const source = await fetch(`${endpoint}/package.json`, { headers: { Accept: 'text/html' } });
assert.equal(source.status, 404, 'Project source files must remain blocked');
