/** Serves the test double of the public sources over HTTP (for browser UI tests only). */
import { createServer } from 'node:http';

import { buildWorld, fakeFetch } from '../src/data/testing/fakeSources';

buildWorld();
const port = Number(process.argv[2] ?? 8090);
createServer(async (req, res) => {
  const [host, ...rest] = (req.url ?? '/').slice(1).split('/');
  const r = await fakeFetch(`https://${host}/${rest.join('/')}`);
  const body = await r.text();
  res.writeHead(r.status, { 'Content-Type': host.includes('clubelo') ? 'text/csv' : 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}).listen(port, () => console.log(`fake sources on :${port}`));
