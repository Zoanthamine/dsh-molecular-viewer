import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

export function resolveQueuedPath(input, cwd) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\u0000')) throw new Error('Invalid local path');
  const path = input.trim();
  if (path[0] === path[1] && (path[0] === '/' || path.charCodeAt(0) === 92)) throw new Error('Network paths are not supported');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new Error('Only local paths are supported');
  if (isAbsolute(path)) return path;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Relative path requires authoritative current working directory; provide an absolute path');
  return resolve(cwd, path);
}

export function normalizeFrameSelector(value = 'all') {
  if (typeof value !== 'string' || value.length > 32) throw new Error('Invalid frame selector');
  const selector = value.trim().toLowerCase();
  if (['all', 'first', 'last', 'last-converged'].includes(selector)) return selector;
  if (!/^[1-9]\d*$/.test(selector) || !Number.isSafeInteger(Number(selector))) throw new Error('Frame must be all, first, last, last-converged or a 1-based positive index');
  return selector;
}
export const PREFIX = '/molecular-viewer';
export const ALLOWED_EXTENSIONS = new Set(['xyz', 'sdf', 'mol', 'pdb', 'ent', 'gjf', 'com', 'inp', 'fchk', 'fch', 'out', 'log', 'output']);
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/parsers.js', ['parsers.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/vendor/3Dmol-min.js', ['vendor/3Dmol-min.js', 'text/javascript; charset=utf-8']],
]);
export class OpenQueue {
  constructor(now = Date.now) { this.entries = new Map(); this.now = now; this.sequence = 0; }
  purge() {
    const cutoff = this.now() - 15 * 60 * 1000;
    for (const [session, rows] of this.entries) {
      const live = rows.filter(row => row.createdAt >= cutoff);
      if (live.length) this.entries.set(session, live); else this.entries.delete(session);
    }
  }
  enqueue(sessionId, path, title, frame = 'all') {
    frame = normalizeFrameSelector(frame);
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('Initiating session required');
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\u0000-\u001f]/.test(path)) throw new Error('Invalid local path');
    path = path.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new Error('Only local paths are supported');
    const ext = path.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('Supported extensions: xyz, sdf, mol, pdb, ent, gjf, com, inp, fchk, fch, out, log, output; GIF images and binary chk are not Cartesian text');
    if (title !== undefined && (typeof title !== 'string' || title.length > 256)) throw new Error('Invalid title');
    this.purge();
    if (!this.entries.has(sessionId) && this.entries.size >= 128) throw new Error('Open queue is full');
    const request = { id: randomUUID(), sequence: ++this.sequence, path, frame, title: title?.trim() || path.split(/[\\/]/).pop(), createdAt: this.now() };
    const rows = this.entries.get(sessionId) || [];
    if (rows.length >= 32) throw new Error('Too many pending opens for this session');
    rows.push(request); this.entries.set(sessionId, rows);
    return request;
  }
  since(sessionId, sequence) {
    this.purge();
    const rows = (this.entries.get(sessionId) || []).filter(row => row.sequence > sequence);
    // Client cursor acknowledges delivery to its tab queue, never successful rendering.
    if (rows.length) this.entries.set(sessionId, rows); else this.entries.delete(sessionId);
    return rows;
  }
  dispose() { this.entries.clear(); }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function createRoute(connection, queue, publicRoot, loadAsset = readFile) {
  return { kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    // The host connection service owns authentication, origin and deployment trust.
    // No local "trusted host" imitation and no fail-open mode.
    try {
      if (!connection || typeof connection.requestRejection !== 'function' || connection.requestRejection(req) !== undefined) {
        json(res, 403, { ok: false, error: 'Connection authentication/trust required' }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { ok: false, error: 'Method not allowed' }); return; }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) { json(res, 404, { ok: false, error: 'Unknown asset' }); return; }
      const suffix = url.pathname.slice(PREFIX.length);
      if (suffix === '/requests') {
        const sessionId = url.searchParams.get('sessionId');
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!sessionId || sessionId.length > 200 || !Number.isSafeInteger(after) || after < 0) { json(res, 400, { ok: false, error: 'Invalid queue query' }); return; }
        json(res, 200, { ok: true, requests: queue.since(sessionId, after) }); return;
      }
      const asset = ASSETS.get(suffix === '' ? '/' : suffix);
      if (!asset) { json(res, 404, { ok: false, error: 'Unknown asset' }); return; }
      const bytes = await loadAsset(new URL(asset[0], publicRoot));
      res.writeHead(200, {
        'Content-Type': asset[1], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
        'Referrer-Policy': 'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      // Do not echo paths, contents, cookies or internal stacks over HTTP.
      json(res, 500, { ok: false, error: 'Viewer resource unavailable' });
    }
  } };
}
