// Configure this app after creating its own Exact signing key and Pages site.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [site, keyId, publicKey] = process.argv.slice(2);
if (!site || !/^[a-zA-Z0-9_-]+$/.test(keyId ?? '') ||
    !/^[A-Za-z0-9+/]{43}=$/.test(publicKey ?? '')) {
  throw new Error('Usage: node scripts/configure-updates.mjs <Pages HTTPS URL> <key id> <base64 public key>');
}
const origin = new URL(site);
if (origin.protocol !== 'https:' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('Expected the HTTPS URL of the Pages site');
}
if (!origin.pathname.endsWith('/')) origin.pathname += '/';
const file = resolve('apps/apps/app.json');
const app = JSON.parse(readFileSync(file, 'utf8'));
delete app.host.web.base;
app.deploy ??= {};
app.deploy.store = { ...app.deploy.store, web: '0', android: 'A', ios: 'A' };
app.deploy.channels = { ...app.deploy.channels, prod: origin.href };
app.deploy.signing = { key: keyId, keys: { ...app.deploy.signing?.keys, [keyId]: publicKey } };
app.deploy.activate = 'immediate';
app.deploy.check = { ...app.deploy.check, interval: 60 };
writeFileSync(file, JSON.stringify(app, null, 2) + '\n');
