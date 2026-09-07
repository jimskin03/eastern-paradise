import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Mailer } from '../src/mailer.js';

function httpReq(base, reqPath, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}${reqPath}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    request.on('error', reject);
    if (body) request.write(typeof body === 'string' ? body : JSON.stringify(body));
    request.end();
  });
}

function startServer(port, extraEnv = {}) {
  const env = {
    ...process.env,
    PORT: String(port),
    RESEND_API_KEY: '',
    SMTP_URL: '',
    ...extraEnv
  };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  const base = `http://localhost:${port}`;
  return { srv, base, ready: new Promise(res => setTimeout(res, 800)) };
}

function readSink(dir) {
  const file = path.join(dir, 'verification_emails.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line));
}

test('mailer file-sink mode delivers sponsor email and never leaks the token over HTTP', async (t) => {
  const sinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-mail-'));
  t.after(() => { try { fs.rmSync(sinkDir, { recursive: true, force: true }); } catch (_) {} });

  const { srv, base, ready } = startServer(3046, { MAIL_SINK_DIR: sinkDir });
  t.after(() => srv.kill());
  await ready;

  // 1. Register: HTTP response must NOT contain the verification token or api key in file mode
  const name1 = `MailE2E_${Date.now().toString().slice(-5)}`;
  const reg = await httpReq(base, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: name1, email: 'sponsor.file@example.com' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.success, true);
  assert.equal(reg.data.mail_mode, 'file');
  assert.equal(reg.data.verification_required, true);
  assert.equal(reg.data.verification_token, undefined, 'token must not leak in file mode');
  assert.equal(reg.data.api_key, undefined, 'api_key must not leak in file mode');

  // 2. The "email" (sink record) must contain the verify URL and the API key
  const records = readSink(sinkDir);
  const mine = records.find(r => r.agentName === name1);
  assert.ok(mine, 'sink must contain a record for the new agent');
  assert.match(mine.verifyUrl, /\/verify\?token=vtok_/);
  assert.ok(mine.apiKey && mine.apiKey.startsWith('ep_key_'), 'initial email must contain apiKey');
  assert.equal(mine.to, 'sponsor.file@example.com');

  // The emailed link is the human-facing /verify page; the token itself is
  // exchanged at the JSON endpoint (exactly what verify.html does in-browser).
  const tokenParam = new URL(mine.verifyUrl).searchParams.get('token');
  assert.ok(tokenParam && tokenParam.startsWith('vtok_'));
  const verify = await httpReq(base, `/api/auth/verify?token=${encodeURIComponent(tokenParam)}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.data.success, true);
  const apiKey = verify.data.account.api_key;
  assert.equal(apiKey, mine.apiKey, 'verified api_key matches initial emailed api_key');

  // Verify that post-verification API key email was also sunk
  await new Promise(r => setTimeout(r, 150));
  const postRecords = readSink(sinkDir);
  const postVerifyEmail = postRecords.find(r => r.agentName === name1 && r.type === 'api_key_delivery');
  assert.ok(postVerifyEmail, 'sink must receive post-verification api key delivery email');
  assert.equal(postVerifyEmail.apiKey, apiKey);

  // 3. Login works with the key the sponsor received
  const login = await httpReq(base, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { agent_name: name1, api_key: apiKey });
  assert.equal(login.status, 200);

  // 4. Resend endpoint re-delivers for a still-pending account
  const name2 = `MailResend_${Date.now().toString().slice(-5)}`;
  const reg2 = await httpReq(base, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: name2, email: 'sponsor.resend@example.com' });
  assert.equal(reg2.status, 201);
  const before = readSink(sinkDir).length;
  const resend = await httpReq(base, '/api/auth/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { agent_name: name2 });
  assert.equal(resend.status, 200);
  assert.equal(resend.data.success, true);
  const after = readSink(sinkDir).length;
  assert.ok(after >= before + 1, 'resend must append another sink record');
  const resendRec = readSink(sinkDir).reverse().find(r => r.agentName === name2);
  assert.ok(resendRec);
  assert.ok(resendRec.apiKey && resendRec.apiKey.startsWith('ep_key_'), 'resend email must contain apiKey');
});

test('recent_dispatches endpoint must not leak verify tokens in real mail modes', async (t) => {
  const sinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-mail-leak-'));
  t.after(() => { try { fs.rmSync(sinkDir, { recursive: true, force: true }); } catch (_) {} });

  const { srv, base, ready } = startServer(3050, { MAIL_SINK_DIR: sinkDir });
  t.after(() => srv.kill());
  await ready;

  // Register one agent so a dispatch record exists
  const reg = await httpReq(base, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: `LeakProbe_${Date.now().toString().slice(-5)}`, email: 'sponsor.leak@example.com' });
  assert.equal(reg.status, 201);

  // Unauthenticated read must NOT reveal the token
  const anon = await httpReq(base, '/api/dev/recent_dispatches');
  assert.equal(anon.status, 403);
  assert.ok(!JSON.stringify(anon.data).includes('vtok_'));

  // With admin token: visible but redacted
  const env = { ...process.env, PORT: '3051', RESEND_API_KEY: '', SMTP_URL: '', MAIL_SINK_DIR: sinkDir, SNAPSHOT_TOKEN: 'admin-secret' };
  const srv2 = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  t.after(() => srv2.kill());
  await new Promise(res => setTimeout(res, 800));
  const base2 = 'http://localhost:3051';

  // Separate process = separate in-memory dispatch list; create a record there too.
  const reg2 = await httpReq(base2, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: `LeakProbe2_${Date.now().toString().slice(-5)}`, email: 'sponsor.leak2@example.com' });
  assert.equal(reg2.status, 201);

  const authed = await httpReq(base2, '/api/dev/recent_dispatches', { headers: { Authorization: 'Bearer admin-secret' } });
  assert.equal(authed.status, 200);
  const blob = JSON.stringify(authed.data);
  assert.ok(blob.includes('[REDACTED]'), 'verifyUrl must be redacted');
  assert.ok(!blob.includes('vtok_'), 'raw token must not appear');
});

test('register rejects sponsor emails outside the allowlist without creating an account', async (t) => {
  const { srv, base, ready } = startServer(3047, { MAIL_SINK_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ep-mail-')) });
  t.after(() => srv.kill());
  await ready;

  const name = `RejectMe_${Date.now().toString().slice(-5)}`;
  const reg = await httpReq(base, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name, email: 'evil@not-allowed.tld' });
  assert.equal(reg.status, 400);
  assert.equal(reg.data.success, false);
  assert.equal(reg.data.verification_token, undefined);

  // Account must NOT have been created
  const login = await httpReq(base, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { agent_name: name, api_key: 'ep_key_00000000000000000000000000000000' });
  assert.equal(login.status, 401);
});

test('Resend provider failure surfaces as HTTP 502', async (t) => {
  // Local mock Resend that always fails
  const mock = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'mock provider down' }));
  });
  await new Promise(res => mock.listen(3048, res));
  t.after(() => mock.close());

  const { srv, base, ready } = startServer(3049, {
    RESEND_API_KEY: 'test-key-not-real',
    MAIL_RESEND_URL: 'http://localhost:3048/emails'
  });
  t.after(() => srv.kill());
  await ready;

  const reg = await httpReq(base, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: `FailingMail_${Date.now().toString().slice(-5)}`, email: 'sponsor.fail@example.com' });
  assert.equal(reg.status, 502);
  assert.equal(reg.data.success, false);
  assert.match(reg.data.error, /could not be delivered/);
});

test('unit: Mailer file sink writes a well-formed record; console mode is the default', async (t) => {
  const sinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-mail-unit-'));
  t.after(() => { try { fs.rmSync(sinkDir, { recursive: true, force: true }); } catch (_) {} });

  process.env.MAIL_SINK_DIR = sinkDir;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_URL;
  const out = await Mailer.sendVerificationEmail({
    toEmail: 'unit@example.com', agentName: 'UnitTester',
    verificationToken: 'vtok_unit', apiKey: 'ep_key_unit', verifyUrl: 'http://localhost:9/verify?token=vtok_unit'
  });
  assert.equal(out.mode, 'file');
  const recs = readSink(sinkDir);
  const rec = recs.find(r => r.agentName === 'UnitTester');
  assert.ok(rec);
  assert.equal(rec.to, 'unit@example.com');
  assert.equal(rec.apiKey, 'ep_key_unit');
  assert.equal(rec.mode, 'file');
  assert.ok(rec.subject.includes('UnitTester'));

  const keyOut = await Mailer.sendApiKeyEmail({
    toEmail: 'unit@example.com', agentName: 'UnitTester',
    apiKey: 'ep_key_unit', hostUrl: 'http://localhost:9'
  });
  assert.equal(keyOut.mode, 'file');
  const keyRecs = readSink(sinkDir);
  const keyRec = keyRecs.find(r => r.agentName === 'UnitTester' && r.type === 'api_key_delivery');
  assert.ok(keyRec);
  assert.equal(keyRec.apiKey, 'ep_key_unit');

  delete process.env.MAIL_SINK_DIR;

  // Default with no env is console (no real delivery)
  assert.equal(Mailer.mode, 'console');
  const consoleOut = await Mailer.sendVerificationEmail({
    toEmail: 'unit@example.com', agentName: 'UnitTester2',
    verificationToken: 'vtok_unit2', apiKey: 'ep_key_unit2', verifyUrl: 'http://localhost:9/verify?token=vtok_unit2'
  });
  assert.equal(consoleOut.mode, 'console');
  assert.equal(consoleOut.delivered, false);
});
