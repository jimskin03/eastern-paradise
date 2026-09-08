import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { sendJson } from '../helpers/response.js';

function tokenMatches(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function handleAdminRoutes(ctx) {
  const { req, res, pathname, services, runtime } = ctx;
  const { db, CloudStorage } = services;

  if (pathname === '/api/admin/snapshot' && req.method === 'GET') {
    const expected = process.env.SNAPSHOT_TOKEN;
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!expected) {
      return sendJson(res, 403, { success: false, message: 'Snapshot endpoint disabled (SNAPSHOT_TOKEN not configured).' });
    }
    if (!tokenMatches(provided, expected)) {
      return sendJson(res, 401, { success: false, message: 'Invalid snapshot token.' });
    }
    try {
      runtime.markActivity();
      const tmpPath = path.join(os.tmpdir(), `paradise-snapshot-${process.pid}-${Date.now()}.db`);
      await backup(db, tmpPath);
      const readStream = fs.createReadStream(tmpPath);
      readStream.on('close', () => { try { fs.unlinkSync(tmpPath); } catch {} });
      readStream.on('error', () => { try { fs.unlinkSync(tmpPath); } catch {} });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="paradise-snapshot.db"',
        'Content-Length': fs.statSync(tmpPath).size
      });
      readStream.pipe(res);
      return true;
    } catch (snapErr) {
      console.error('[Snapshot] backup failed:', snapErr);
      return sendJson(res, 500, { success: false, message: 'Snapshot failed: ' + snapErr.message });
    }
  }

  if (pathname === '/api/admin/wipe_logs' && req.method === 'POST') {
    const expected = process.env.SNAPSHOT_TOKEN;
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!expected) {
      return sendJson(res, 403, { success: false, message: 'Endpoint disabled (SNAPSHOT_TOKEN not configured).' });
    }
    if (!tokenMatches(provided, expected)) {
      return sendJson(res, 401, { success: false, message: 'Invalid admin token.' });
    }
    try {
      runtime.markActivity();
      const wipeResult = await CloudStorage.wipeNonAiliciaLogs();
      return sendJson(res, 200, { success: true, ...wipeResult });
    } catch (wipeErr) {
      console.error('[Admin:WipeLogs] failed:', wipeErr);
      return sendJson(res, 500, { success: false, message: 'Wipe failed: ' + wipeErr.message });
    }
  }

  return false;
}
