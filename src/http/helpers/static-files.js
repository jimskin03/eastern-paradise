import fs from 'node:fs';
import path from 'node:path';

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
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
      res.end();
      return true;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString()
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}
