// Temple Explorer — study server
//
// Serves the walkthrough itself and stores each finished session in Redis.
// Deliberately small: one POST that participants hit, and a few read-only
// endpoints for Provat that need an admin token.
//
// Environment variables:
//   REDIS_URL     redis://... or rediss://... — where sessions are stored
//   ADMIN_TOKEN   secret for the read/export endpoints. Without it those
//                 endpoints stay switched off rather than serving
//                 participant data to anyone who guesses the path.
//   PORT          set by the host; defaults to 3000 locally
//
// Redis layout:
//   te:session:<id>   the full session record, as JSON
//   te:sessions       sorted set of ids, scored by arrival time, so sessions
//                     can be listed newest-first without scanning keys
//   te:student:<id>   set of session ids for one student id, so a student's
//                     walkthroughs can be found when matching questionnaires

import express from 'express';
import { createClient } from 'redis';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const REDIS_URL = process.env.REDIS_URL || '';

// --- Redis ---------------------------------------------------------------
// Connected in the background rather than awaited at startup: if Redis is
// down or misconfigured, the walkthrough itself must still be playable.
// Sessions then fail to save and the page says so, which is far better than
// the whole site refusing to boot.
const redis = createClient({
  url: REDIS_URL || undefined,
  // Without this, commands issued while the connection is down are queued and
  // wait for a reconnection that may never come — a participant pressing
  // Submit would hang forever instead of being offered their file. Fail fast
  // instead; the page handles a refusal gracefully.
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => Math.min(200 * 2 ** retries, 10000),
  },
});

// Belt and braces for the same problem: a connection can be "ready" and still
// stall mid-command. Nothing here should ever leave the browser waiting.
const REDIS_TIMEOUT_MS = 6000;

function withTimeout(promise, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`redis timeout: ${what}`)), REDIS_TIMEOUT_MS)
    ),
  ]);
}

let redisReady = false;
redis.on('ready', () => {
  redisReady = true;
  console.log('[redis] ready');
});
redis.on('end', () => {
  redisReady = false;
  console.log('[redis] connection closed');
});
redis.on('error', (error) => {
  // node-redis retries on its own; log once per failure without crashing.
  console.error('[redis] error:', error.message);
});

if (REDIS_URL) {
  redis.connect().catch((error) => {
    console.error('[redis] initial connect failed:', error.message);
  });
} else {
  console.warn('[redis] REDIS_URL is not set — sessions cannot be saved');
}

// --- App -----------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for real IPs

// A session record is a few KB. 1 MB is generous and stops anyone posting
// something enormous.
app.use(express.json({ limit: '1mb' }));

// A small throttle, because POST /api/session is necessarily open to the
// public. Enough to stop idle mischief; not meant as real DDoS protection.
const POST_WINDOW_MS = 10 * 60 * 1000;
const POST_MAX_PER_WINDOW = 30;
const postHistory = new Map();

function throttled(ip) {
  const now = Date.now();
  const hits = (postHistory.get(ip) || []).filter((t) => now - t < POST_WINDOW_MS);
  hits.push(now);
  postHistory.set(ip, hits);
  if (postHistory.size > 5000) postHistory.clear(); // crude but bounded
  return hits.length > POST_MAX_PER_WINDOW;
}

function adminAuthorised(req) {
  if (!ADMIN_TOKEN) return false;
  const given = String(
    req.query.token || (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
  );
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: 'ADMIN_TOKEN is not set on the server, so this endpoint is off.',
    });
  }
  if (!adminAuthorised(req)) return res.status(401).json({ ok: false, error: 'bad token' });
  return next();
}

// --- Saving a session ----------------------------------------------------
app.post('/api/session', async (req, res) => {
  if (throttled(req.ip)) {
    return res.status(429).json({ ok: false, error: 'too many sessions from this address' });
  }

  const record = req.body;
  if (!record || typeof record !== 'object' || !record.session || !record.participant) {
    return res.status(400).json({ ok: false, error: 'not a session record' });
  }
  if (!record.participant.consentedAt) {
    return res.status(400).json({ ok: false, error: 'no consent recorded' });
  }

  if (!redisReady) {
    return res.status(503).json({ ok: false, error: 'database unavailable' });
  }

  const id = randomUUID();
  const receivedAt = Date.now();
  const stored = { ...record, id, receivedAt: new Date(receivedAt).toISOString() };

  try {
    const writes = redis
      .multi()
      .set(`te:session:${id}`, JSON.stringify(stored))
      .zAdd('te:sessions', { score: receivedAt, value: id });

    const studentId = String(record.participant.studentId || '').trim();
    if (studentId) writes.sAdd(`te:student:${studentId}`, id);

    await withTimeout(writes.exec(), 'save session');
    console.log(
      `[session] saved ${id} — ${record.participant.role}` +
        (studentId ? ` (${studentId})` : '') +
        ` — ${record.session.activeSec}s active`
    );
    return res.json({ ok: true, id });
  } catch (error) {
    console.error('[session] save failed:', error.message);
    return res.status(500).json({ ok: false, error: 'could not save' });
  }
});

// --- Reading them back ---------------------------------------------------
// Actually pings Redis rather than reporting the last connection event seen —
// that flag can lag reality by a second or two, and a health check that lies
// is worse than none. Open this after a deploy to check the wiring.
app.get('/api/health', async (req, res) => {
  let database = 'not configured';
  if (REDIS_URL) {
    try {
      await withTimeout(redis.ping(), 'ping');
      database = 'up';
    } catch (error) {
      database = 'down';
    }
  }
  res.json({ ok: true, database, adminEnabled: Boolean(ADMIN_TOKEN) });
});

async function loadSessions(limit) {
  const ids = await withTimeout(
    redis.zRange('te:sessions', 0, limit - 1, { REV: true }),
    'list ids'
  );
  if (ids.length === 0) return [];
  const raw = await withTimeout(
    redis.mGet(ids.map((id) => `te:session:${id}`)),
    'read sessions'
  );
  return raw.filter(Boolean).map((text) => JSON.parse(text));
}

// Summaries only — enough to see who has been through without pulling every
// path sample down the wire.
app.get('/api/sessions', requireAdmin, async (req, res) => {
  if (!redisReady) return res.status(503).json({ ok: false, error: 'database unavailable' });
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  try {
    const sessions = await loadSessions(limit);
    res.json({
      ok: true,
      count: await withTimeout(redis.zCard('te:sessions'), 'count'),
      sessions: sessions.map((s) => ({
        id: s.id,
        receivedAt: s.receivedAt,
        role: s.participant.role,
        studentId: s.participant.studentId || '',
        institution: s.participant.institution || '',
        activeSec: s.session.activeSec,
        endReason: s.session.endReason,
        ...s.summary,
        questionnaire: s.questionnaire,
      })),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Everything, exactly as stored — this is the archive to keep.
app.get('/api/export.json', requireAdmin, async (req, res) => {
  if (!redisReady) return res.status(503).json({ ok: false, error: 'database unavailable' });
  try {
    const sessions = await loadSessions(10000);
    res.setHeader('Content-Disposition', 'attachment; filename="temple-sessions.json"');
    res.json({ exportedAt: new Date().toISOString(), count: sessions.length, sessions });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// One row per session, for opening in Excel. The path samples are left out
// on purpose — they belong in the JSON export, not a spreadsheet cell.
const CSV_COLUMNS = [
  ['id', (s) => s.id],
  ['received', (s) => s.receivedAt],
  ['started', (s) => s.session.startedAt],
  ['role', (s) => s.participant.role],
  ['student_id', (s) => s.participant.studentId || ''],
  ['institution', (s) => s.participant.institution || ''],
  ['consented_at', (s) => s.participant.consentedAt],
  ['duration_s', (s) => s.session.durationSec],
  ['active_s', (s) => s.session.activeSec],
  ['end_reason', (s) => s.session.endReason],
  ['furthest_z', (s) => s.summary.furthestZ],
  ['reached_sanctuary', (s) => s.summary.reachedSanctuary],
  ['walked_m', (s) => s.summary.distanceWalkedM],
  ['scrolls_opened', (s) => s.summary.scrollsOpened],
  ['unique_scrolls', (s) => s.summary.uniqueScrollsOpened],
  ['reading_s', (s) => s.summary.scrollReadSec],
  ['torch_lit_count', (s) => s.summary.torchLitCount],
  ['approach_s', (s) => s.zoneSeconds?.approach],
  ['court_s', (s) => s.zoneSeconds?.court],
  ['hypostyle_s', (s) => s.zoneSeconds?.hypostyle],
  ['inner_court_s', (s) => s.zoneSeconds?.['inner-court']],
  ['sanctuary_s', (s) => s.zoneSeconds?.sanctuary],
  // Section A. Background
  ['screen_time', (s) => s.questionnaire?.screen_time],
  ['screen_time_detail', (s) => s.questionnaire?.screen_time_detail],
  ['game_frequency', (s) => s.questionnaire?.game_frequency],
  ['used_vr', (s) => s.questionnaire?.used_vr],
  ['used_3d_tool', (s) => s.questionnaire?.used_3d_tool],
  ['history_engagement', (s) => joinIfArray(s.questionnaire?.history_engagement)],
  ['interactive_effectiveness', (s) => s.questionnaire?.interactive_effectiveness],
  // Section B. Spatial Knowledge Check (optional)
  ['spatial_sequence', (s) => s.questionnaire?.spatial_sequence],
  ['spatial_sequence_detail', (s) => s.questionnaire?.spatial_sequence_detail],
  ['hypostyle_columns', (s) => s.questionnaire?.hypostyle_columns],
  ['light_change', (s) => s.questionnaire?.light_change],
  ['capital_types', (s) => s.questionnaire?.capital_types],
  ['sanctuary_function', (s) => s.questionnaire?.sanctuary_function],
  // Section C. Experience with the walkthrough
  ['engaging', (s) => s.questionnaire?.engaging],
  ['historical_understanding', (s) => s.questionnaire?.historical_understanding],
  ['ease_of_navigation', (s) => s.questionnaire?.ease_of_navigation],
  ['pace_vs_video', (s) => s.questionnaire?.pace_vs_video],
  ['emotional_connection', (s) => s.questionnaire?.emotional_connection],
  ['curiosity', (s) => s.questionnaire?.curiosity],
  ['retention_vs_traditional', (s) => s.questionnaire?.retention_vs_traditional],
  ['favorite_feature', (s) => s.questionnaire?.favorite_feature],
  ['favorite_feature_detail', (s) => s.questionnaire?.favorite_feature_detail],
  ['motivation_to_explore', (s) => s.questionnaire?.motivation_to_explore],
  ['technical_difficulties', (s) => s.questionnaire?.technical_difficulties],
  ['technical_difficulties_detail', (s) => s.questionnaire?.technical_difficulties_detail],
  ['device_used', (s) => s.questionnaire?.device_used],
  ['device_used_detail', (s) => s.questionnaire?.device_used_detail],
  // Section D. Open-ended feedback
  ['suggestions', (s) => s.questionnaire?.suggestions],
  ['fps_avg', (s) => s.device?.fpsAvg],
  ['fps_min', (s) => s.device?.fpsMin],
  ['screen', (s) => s.device?.screen],
  ['browser', (s) => s.device?.userAgent],
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// history_engagement (Q5) is the one multi-select question, so its answer is
// an array rather than a single string — flatten it to one cell so the CSV
// stays one row per session.
function joinIfArray(value) {
  return Array.isArray(value) ? value.join('; ') : value;
}

app.get('/api/export.csv', requireAdmin, async (req, res) => {
  if (!redisReady) return res.status(503).json({ ok: false, error: 'database unavailable' });
  try {
    const sessions = await loadSessions(10000);
    const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
    for (const session of sessions) {
      lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(session))).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="temple-sessions.csv"');
    res.send('\uFEFF' + lines.join('\n')); // BOM so Excel reads the accents
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- The walkthrough itself ----------------------------------------------
// Served from the same origin as the API, so the browser can read the save
// confirmation properly — no CORS, no guessing whether it worked.
app.use(
  express.static(HERE, {
    setHeaders(res, filePath) {
      // The model and the scrolls never change without a new filename, so
      // let browsers keep them. index.html must not be cached or a deploy
      // would not reach anyone.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      else if (/\.(glb|webp|png|jpg|mp4)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  })
);

app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
  console.log(`[server] admin endpoints ${ADMIN_TOKEN ? 'enabled' : 'DISABLED (set ADMIN_TOKEN)'}`);
});
