// Temple Explorer — study logging (Session 7)
//
// Records what a participant actually did inside the walkthrough, so the
// paper can report behaviour and not only what people say afterwards.
//
// Nothing here needs a server. The walkthrough stays a static site: each
// finished session is POSTed to a Google Apps Script web app that appends a
// row to a Google Sheet Provat owns, AND offered as a file download so a
// session is never lost if the network or the sheet misbehaves.
//
// ---------------------------------------------------------------------
// SETUP — paste the web-app address on the next line and automatic saving
// starts working. Leave it empty and everything still works, just
// download-only. Instructions are in STUDY-SETUP.md next to this file.
export const ENDPOINT = '';
// ---------------------------------------------------------------------

// How often the player's position is written down. 2 Hz is plenty to
// reconstruct a path and to total up dwell time, and keeps a 15-minute
// session to roughly 1800 samples.
const SAMPLE_HZ = 2;

// Zones along the temple's axis, as depth from the spawn point (the same
// z-offset the minimap and content.js use, metres, negative = further in).
// The boundaries come from the measured checkpoint positions: the gate sits
// at -41, the hypostyle columns at -122, the inner court at -147, the
// chapels and sanctuary beyond -155. Edit these if the zones should be cut
// differently for the analysis — nothing else depends on them.
const ZONES = [
  { name: 'approach', from: Infinity, to: -41 },
  { name: 'court', from: -41, to: -110 },
  { name: 'hypostyle', from: -110, to: -135 },
  { name: 'inner-court', from: -135, to: -155 },
  { name: 'sanctuary', from: -155, to: -Infinity },
];

export function zoneAt(offsetZ) {
  for (const zone of ZONES) {
    if (offsetZ <= zone.from && offsetZ > zone.to) return zone.name;
  }
  return 'approach';
}

const SCHEMA_VERSION = 1;

export const study = {
  active: false,
  participant: null,
  startedAt: 0,
  startedAtIso: '',

  zoneSeconds: {},
  path: [],          // [seconds, x, y, z] from spawn, 2 Hz
  scrolls: [],       // one entry per scroll opened
  torch: [],         // lit / out events
  furthestZ: 0,
  distanceWalked: 0,

  _sampleTimer: 0,
  _lastSample: null,
  _openScroll: null,
  _fpsSum: 0,
  _fpsCount: 0,
  _fpsMin: Infinity,
  _finished: false,
  questionnaire: null,

  begin(participant) {
    this.active = true;
    this.participant = participant;
    this.startedAt = performance.now();
    this.startedAtIso = new Date().toISOString();
    for (const zone of ZONES) this.zoneSeconds[zone.name] = 0;
  },

  seconds() {
    return (performance.now() - this.startedAt) / 1000;
  },

  // Called every frame with the player's position as an offset from spawn.
  tick(deltaTime, offset, fps) {
    if (!this.active) return;

    const zone = zoneAt(offset.z);
    this.zoneSeconds[zone] = (this.zoneSeconds[zone] || 0) + deltaTime;
    if (offset.z < this.furthestZ) this.furthestZ = offset.z;

    if (Number.isFinite(fps) && fps > 0) {
      this._fpsSum += fps;
      this._fpsCount++;
      if (fps < this._fpsMin) this._fpsMin = fps;
    }

    this._sampleTimer += deltaTime;
    if (this._sampleTimer >= 1 / SAMPLE_HZ) {
      this._sampleTimer = 0;
      const t = round(this.seconds(), 1);
      const x = round(offset.x, 2);
      const y = round(offset.y, 2);
      const z = round(offset.z, 2);
      if (this._lastSample) {
        const dx = x - this._lastSample[1];
        const dz = z - this._lastSample[3];
        this.distanceWalked += Math.sqrt(dx * dx + dz * dz);
      }
      this._lastSample = [t, x, y, z];
      this.path.push(this._lastSample);
    }
  },

  scrollOpened(id, offset) {
    if (!this.active) return;
    this._openScroll = {
      id,
      openedAt: round(this.seconds(), 1),
      zone: zoneAt(offset.z),
      pages: 1,
    };
  },

  scrollPageTurned() {
    if (this._openScroll) this._openScroll.pages++;
  },

  scrollClosed() {
    if (!this.active || !this._openScroll) return;
    this._openScroll.seconds = round(this.seconds() - this._openScroll.openedAt, 1);
    this.scrolls.push(this._openScroll);
    this._openScroll = null;
  },

  torchEvent(action, offset) {
    if (!this.active) return;
    this.torch.push({
      action, // 'lit' | 'out'
      at: round(this.seconds(), 1),
      zone: zoneAt(offset.z),
      z: round(offset.z, 1),
    });
  },

  // The record as it will be saved. Kept flat and obvious so it can be
  // opened in any text editor and understood without this file.
  buildRecord(endReason) {
    const uniqueScrolls = new Set(this.scrolls.map((s) => s.id));
    // Two different clocks, and the analysis wants both. durationSec is wall
    // clock from sign-in, so it includes any time the participant sat on the
    // pause screen or looked away. activeSec only counts frames where they
    // were actually inside the temple with the pointer locked, so it is the
    // honest denominator for "how long did they spend in the court".
    const activeSec = Object.values(this.zoneSeconds).reduce((a, b) => a + b, 0);
    return {
      schema: SCHEMA_VERSION,
      participant: this.participant,
      session: {
        startedAt: this.startedAtIso,
        endedAt: new Date().toISOString(),
        durationSec: round(this.seconds(), 1),
        activeSec: round(activeSec, 1),
        endReason,
      },
      summary: {
        furthestZ: round(this.furthestZ, 1),
        reachedSanctuary: this.furthestZ <= -155,
        distanceWalkedM: round(this.distanceWalked, 1),
        scrollsOpened: this.scrolls.length,
        uniqueScrollsOpened: uniqueScrolls.size,
        scrollReadSec: round(
          this.scrolls.reduce((sum, s) => sum + (s.seconds || 0), 0), 1
        ),
        torchLitCount: this.torch.filter((t) => t.action === 'lit').length,
      },
      questionnaire: this.questionnaire || null,
      zoneSeconds: roundAll(this.zoneSeconds),
      scrolls: this.scrolls,
      torch: this.torch,
      device: {
        screen: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        pixelRatio: window.devicePixelRatio,
        fpsAvg: this._fpsCount ? round(this._fpsSum / this._fpsCount, 1) : null,
        fpsMin: this._fpsMin === Infinity ? null : round(this._fpsMin, 1),
        userAgent: navigator.userAgent,
        language: navigator.language,
      },
      path: this.path,
    };
  },

  // Send to the sheet. Deliberately fire-and-forget with no-cors: Apps
  // Script does not send CORS headers back, so the browser will not let us
  // read the reply — the row still gets written. Because we cannot confirm
  // it, the download below is always offered too.
  async send(record) {
    if (!ENDPOINT) return { attempted: false };
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(record),
      });
      return { attempted: true, ok: true };
    } catch (error) {
      console.warn('[study] upload failed, the download still has it:', error);
      return { attempted: true, ok: false };
    }
  },

  download(record) {
    const who =
      (record.participant.studentId || record.participant.role || 'participant')
        .replace(/[^A-Za-z0-9_-]/g, '');
    const stamp = record.session.startedAt.replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify(record, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `temple-${who}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  async finish(endReason, answers) {
    if (!this.active || this._finished) return null;
    this.questionnaire = answers || null;
    this._finished = true;
    // Close a scroll that was still open before going inactive — scrollClosed
    // ignores calls once inactive, so the order here matters. Getting this
    // backwards silently dropped the last scroll a participant read, which is
    // exactly the one they were looking at when they decided to stop.
    this.scrollClosed();
    this.active = false;
    const record = this.buildRecord(endReason);
    const sent = await this.send(record);
    this.download(record);
    console.log('[study] session recorded', record);
    return { record, sent };
  },

  // Last-ditch save if the tab is closed mid-session. sendBeacon survives
  // page unload where fetch does not; there is no chance to download here,
  // which is exactly why the Finish button matters.
  abandon() {
    if (!this.active || this._finished || !ENDPOINT) return;
    const record = this.buildRecord('tab-closed');
    try {
      navigator.sendBeacon(ENDPOINT, JSON.stringify(record));
    } catch (error) {
      /* nothing useful left to do at this point */
    }
  },
};

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function roundAll(obj) {
  const out = {};
  for (const key of Object.keys(obj)) out[key] = round(obj[key], 1);
  return out;
}
