import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream';

function acceptsGzip(header = '') {
  const encodings = String(header).toLowerCase().split(',').map(value => {
    const [name, ...params] = value.trim().split(';');
    const quality = params.find(param => param.trim().startsWith('q='));
    return { name, quality: quality ? Number(quality.trim().slice(2)) : 1 };
  });
  return (encodings.find(value => value.name === 'gzip')
    ?? encodings.find(value => value.name === '*'))?.quality > 0;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export function serveStaticFile({ pathname, req, res, publicDir }) {
  let filePath = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  if (pathname === '/verify') {
    filePath = path.join(publicDir, 'verify.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const compressible = /^(text\/|application\/json|image\/svg\+xml)/.test(mime);
    const gzip = compressible && stat.size >= 1024 && acceptsGzip(req?.headers?.['accept-encoding']);
    const vary = compressible ? { Vary: 'Accept-Encoding' } : {};
    const etag = `W/\"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}\"`;
    const hashedAsset = /\.[a-f0-9]{8,}\./i.test(path.basename(filePath));
    const isHtml = ext === '.html';
    const isWalletBundle = pathname.includes('/js/vendor/metamask-solana.bundle.js');
    const cacheControl = isHtml
      ? 'no-cache'
      : hashedAsset
        ? 'public, max-age=31536000, immutable'
        : isWalletBundle
          ? 'public, max-age=86400, must-revalidate'
          : 'public, max-age=3600, must-revalidate';

    if (req?.headers?.['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl, ...vary });
      res.end();
      return true;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      ...(gzip ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': stat.size }),
      ...vary,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString()
    });
    if (req?.method === 'HEAD') {
      res.end();
      return true;
    }
    const streams = [fs.createReadStream(filePath)];
    if (gzip) streams.push(createGzip());
    pipeline(...streams, res, err => { if (err) res.destroy(err); });
    return true;
  }

  return false;
}
