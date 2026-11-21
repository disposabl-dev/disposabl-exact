import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { route, generatedSnapshotOnly, onlyOtherPlatformManifestChanged } from './route-updates.mjs';
const sha = 'a'.repeat(40), aid = 'b'.repeat(64), iid = 'c'.repeat(64), old = 'd'.repeat(64);
const row = (platform, compatibilityId, action = 'bundle', reason) => ({ kind: 'stream', platform, compatibilityId, action, head: { seq: 1 }, ...(reason ? { reason } : {}) });
const table = rows => ({ dryRun: true, channel: 'prod', snapshot: { commit: sha, dirty: false }, rows });
const bases = { android: { compatibilityId: aid }, ios: { compatibilityId: iid } }, verified = new Set([aid, iid, old]);
test('compatible current streams ignore superseded binary cohorts', () => {
  const got = route(table([row('android', aid), row('ios', iid, 'current'), row('android', old, 'binary', 'app.plan: androidUses.camera (not in the installed APK; that needs a new APK)')]), bases, verified, sha);
  assert.equal(got.android.action, 'bundle'); assert.equal(got.ios.action, 'current');
});
test('concrete native capability change routes only affected platform', () => {
  const got = route(table([row('android', aid, 'binary', 'app.plan: androidUses.camera (not in the installed APK; that needs a new APK); a new APK: EXACT_UPDATE_TRUST=production bun exact.mjs android --release (--bundle for the store)'), row('ios', iid)]), bases, verified, sha);
  assert.equal(got.android.action, 'native'); assert.equal(got.ios.action, 'bundle');
});
test('no base routes native but broken existing heads do not', () => {
  assert.equal(route(table([row('ios', iid)]), { ios: bases.ios }, verified, sha).android.action, 'native');
  assert.throws(() => route(table([row('android', aid), row('ios', iid)]), bases, new Set([iid]), sha), /unauthenticated/);
  assert.throws(() => route(table([{...row('android', aid), head:{unusable:'signature'}}, row('ios', iid)]), bases, verified, sha), /Invalid/);
});
test('signing, network and unknown failures never become native repairs', () => {
  for (const reason of ['envelope: signing key is not carried by this cohort', 'bake graph: the installed cohort has no authenticated capability receipt', 'unknown failure', 'app.plan: grantCeiling (unknown baked grants)']) assert.throws(() => route(table([row('android', aid, 'binary', reason), row('ios', iid)]), bases, verified, sha), /Cannot prove/);
  assert.throws(() => route(table([{...row('android', aid),action:'unavailable'}, row('ios', iid)]), bases, verified, sha), /unavailable/);
});
test('snapshot must match exact clean commit', () => assert.throws(() => route(table([]), {}, verified, 'e'.repeat(40)), /snapshot/));

test('pending native inputs trigger repair without suppressing a compatible bundle', () => {
  const got = route(table([row('android', aid), row('ios', iid), {kind:'binary', platform:'android', compatibilityId:aid, action:'binary', pendingInputs:['host.android.permissions']}]), bases, verified, sha);
  assert.equal(got.android.action, 'native'); assert.equal(got.android.updateAction, 'bundle'); assert.equal(got.ios.action, 'bundle');
});

test('only proven baseline-generated paths are ignored for a heading-only edit', () => {
  const t = table([row('android', aid), row('ios', iid), {kind:'binary', platform:'ios', compatibilityId:iid, pendingInputs:['app/.exact/shells/Cargo.toml', 'exact/host/apple/Sources/ExactCore/GeneratedBatch.swift']}]);
  assert.equal(route(t, bases, verified, sha, {ios:['app/.exact/shells/Cargo.toml', 'exact/host/apple/Sources/ExactCore/GeneratedBatch.swift']}).ios.action, 'bundle');
  assert.equal(route(t, bases, verified, sha).ios.action, 'native');
  t.rows[2].pendingInputs.push('app/android/native.rs');
  assert.equal(route(t, bases, verified, sha, {ios:['app/.exact/shells/Cargo.toml', 'exact/host/apple/Sources/ExactCore/GeneratedBatch.swift']}).ios.action, 'native');
});

test('only explicitly enumerated generated additions may be dirty', () => {
 const t=table([row('android',aid),row('ios',iid)]); t.snapshot.dirty=true; t.snapshot.changes=['app A  apps/apps/.exact/shells/android/Cargo.toml'];
 assert.equal(generatedSnapshotOnly(t.snapshot.changes),true); assert.equal(route(t,bases,verified,sha,{},true).android.action,'bundle');
 for (const change of ['app M  apps/apps/app.ts','app A  apps/apps/.exact/shells/android/evil.rs','exact2 A  apps/apps/.exact/shells/Cargo.toml','app A  apps/apps/.exact/shells/../app.ts']) { t.snapshot.changes=[change]; assert.throws(() => route(t,bases,verified,sha,{},true),/dirty/); }
});

test('other platform host metadata leaves this platform baseline safe', () => {
 const before={host:{ios:{minimumOS:'17.0'},android:{}},deploy:{store:{ios:'A',android:'A'}}};
 const after=structuredClone(before); after.host.ios.minimumOS='18.0';
 assert.equal(onlyOtherPlatformManifestChanged(before,after,'android'),true);
 assert.equal(onlyOtherPlatformManifestChanged(before,after,'ios'),false);
 after.deploy.store.android='0'; assert.equal(onlyOtherPlatformManifestChanged(before,after,'android'),false);
});
