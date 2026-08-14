const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIDEO_DIR = path.join(__dirname, '..', 'uploads', 'videos');

function ensureVideoDir() {
  if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

function publicBase(req) {
  const envBase = process.env.VIDEO_PUBLIC_BASE || process.env.PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function toPublicUrl(req, filename) {
  return `${publicBase(req)}/uploads/videos/${filename}`;
}

/**
 * 按 makeBatchId 汇总录像任务
 */
function listRecordJobs(db) {
  const map = new Map();
  for (const o of db.orders || []) {
    if (!o.makeBatchId) continue;
    if (!map.has(o.makeBatchId)) {
      map.set(o.makeBatchId, {
        makeBatchId: o.makeBatchId,
        orderIds: [],
        codes: [],
        makingCount: 0,
        readyOrDone: 0,
        hasVideo: false,
        videoUrl: null,
        makingAt: o.makingAt || null,
      });
    }
    const g = map.get(o.makeBatchId);
    g.orderIds.push(o.id);
    if (o.pickupCode) g.codes.push(o.pickupCode);
    if (o.videoUrl) {
      g.hasVideo = true;
      g.videoUrl = o.videoUrl;
    }
    if (o.status === 'making') g.makingCount += 1;
    if (['ready', 'done'].includes(o.status)) g.readyOrDone += 1;
    if (o.makingAt && (!g.makingAt || o.makingAt < g.makingAt)) g.makingAt = o.makingAt;
  }

  const active = []; // 正在制作且还没视频 → 应录像
  const finalize = []; // 已无 making、尚无视频、但有过制作 → 应停录上传（助手本地判断为主）

  for (const g of map.values()) {
    if (g.makingCount > 0 && !g.hasVideo) active.push(g);
    else if (g.makingCount === 0 && !g.hasVideo && g.codes.length && g.makingAt) finalize.push(g);
  }
  return { active, finalize };
}

function bindVideoToBatch(db, makeBatchId, videoUrl, extra = {}) {
  const now = Date.now();
  let count = 0;
  for (const o of db.orders || []) {
    if (o.makeBatchId !== makeBatchId) continue;
    o.videoUrl = videoUrl;
    o.videoReadyAt = now;
    o.videoMeta = {
      ...(o.videoMeta || {}),
      ...extra,
      makeBatchId,
    };
    o.updatedAt = now;
    count += 1;
  }
  return count;
}

/** 按订单绑定；若有同批 makeBatchId 则整批一起挂视频 */
function bindVideoForOrder(db, orderId, videoUrl, extra = {}) {
  const order = (db.orders || []).find((o) => o.id === orderId);
  if (!order) return 0;
  if (order.makeBatchId) {
    return bindVideoToBatch(db, order.makeBatchId, videoUrl, extra);
  }
  const now = Date.now();
  order.videoUrl = videoUrl;
  order.videoReadyAt = now;
  order.videoMeta = { ...(order.videoMeta || {}), ...extra };
  order.updatedAt = now;
  return 1;
}

function saveUploadedVideo(buffer, makeBatchId) {
  ensureVideoDir();
  const safe = String(makeBatchId || crypto.randomUUID()).replace(/[^\w-]/g, '');
  const filename = `${safe}-${Date.now()}.mp4`;
  const full = path.join(VIDEO_DIR, filename);
  fs.writeFileSync(full, buffer);
  return { filename, full, size: buffer.length };
}

module.exports = {
  VIDEO_DIR,
  ensureVideoDir,
  listRecordJobs,
  bindVideoToBatch,
  bindVideoForOrder,
  saveUploadedVideo,
  toPublicUrl,
  publicBase,
};
