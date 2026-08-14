#!/usr/bin/env node
/**
 * 四季果先 · 门店 RTSP 录像助手
 *
 * 功能：
 * 1. 轮询管理端「制作中」批次，自动开始 ffmpeg 拉流录像
 * 2. 该批次全部离开「制作中」后停止录像
 * 3. 可选裁剪片头片尾若干秒
 * 4. 上传到后端并绑定到同批订单
 *
 * 依赖：本机已安装 ffmpeg，且在 PATH 中
 * 启动：
 *   cd recorder && cp .env.example .env  # 填写后
 *   node index.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execFileSync } = require('child_process');

function loadEnvFile() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
}

loadEnvFile();

const CONFIG = {
  apiBase: (process.env.API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin123',
  rtspUrl: process.env.RTSP_URL || '',
  pollMs: Number(process.env.POLL_MS || 2000),
  trimHeadSec: Number(process.env.TRIM_HEAD_SEC || 1),
  trimTailSec: Number(process.env.TRIM_TAIL_SEC || 1),
  workDir: process.env.WORK_DIR || path.join(__dirname, 'tmp'),
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
};

if (!fs.existsSync(CONFIG.workDir)) fs.mkdirSync(CONFIG.workDir, { recursive: true });

/** @type {Map<string, { proc: import('child_process').ChildProcess, file: string, startedAt: number }>} */
const recording = new Map();
let token = '';

function request(method, urlPath, { body, headers, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(CONFIG.apiBase + urlPath);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = rawBody || (body ? Buffer.from(JSON.stringify(body)) : null);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...(payload && !rawBody ? { 'Content-Type': 'application/json' } : {}),
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { raw: text };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(data.error || `HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const data = await request('POST', '/api/auth/admin/login', {
    body: { username: CONFIG.adminUser, password: CONFIG.adminPass },
  });
  token = data.token;
  console.log('[recorder] 已登录管理端');
}

function whichFfmpeg() {
  try {
    execFileSync(CONFIG.ffmpeg, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function startRecord(makeBatchId) {
  if (recording.has(makeBatchId)) return;
  if (!CONFIG.rtspUrl) {
    console.error('[recorder] 未配置 RTSP_URL');
    return;
  }
  const file = path.join(CONFIG.workDir, `${makeBatchId}-raw.mp4`);
  const args = [
    '-rtsp_transport',
    'tcp',
    '-i',
    CONFIG.rtspUrl,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    file,
  ];
  console.log(`[recorder] 开始录像 ${makeBatchId}`);
  const proc = spawn(CONFIG.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let errBuf = '';
  proc.stderr.on('data', (d) => {
    errBuf += d.toString();
    if (errBuf.length > 2000) errBuf = errBuf.slice(-1000);
  });
  proc.on('exit', (code) => {
    if (code && code !== 0 && recording.has(makeBatchId)) {
      console.warn(`[recorder] ffmpeg 退出 code=${code} ${makeBatchId}`, errBuf.slice(-300));
    }
  });
  recording.set(makeBatchId, { proc, file, startedAt: Date.now() });
}

function probeDuration(file) {
  try {
    const out = execFileSync(
      CONFIG.ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8' }
    );
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function trimVideo(input, output) {
  const dur = probeDuration(input);
  const head = Math.max(0, CONFIG.trimHeadSec);
  const tail = Math.max(0, CONFIG.trimTailSec);
  if (!dur || dur <= head + tail + 1) {
    fs.copyFileSync(input, output);
    return { duration: dur, trimmed: false };
  }
  const len = Math.max(1, dur - head - tail);
  try {
    execFileSync(
      CONFIG.ffmpeg,
      ['-y', '-ss', String(head), '-i', input, '-t', String(len), '-c', 'copy', output],
      { stdio: 'ignore' }
    );
    return { duration: len, trimmed: true };
  } catch {
    execFileSync(
      CONFIG.ffmpeg,
      ['-y', '-ss', String(head), '-i', input, '-t', String(len), '-c:v', 'libx264', '-c:a', 'aac', output],
      { stdio: 'ignore' }
    );
    return { duration: len, trimmed: true };
  }
}

function stopProcess(rec) {
  return new Promise((resolve) => {
    if (!rec?.proc || rec.proc.killed) return resolve();
    const p = rec.proc;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    p.once('exit', finish);
    try {
      p.kill('SIGINT');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish();
    }, 5000);
  });
}

async function finalize(makeBatchId) {
  const rec = recording.get(makeBatchId);
  if (!rec) return;
  recording.delete(makeBatchId);
  console.log(`[recorder] 停止并上传 ${makeBatchId}`);
  await stopProcess(rec);
  // 等 ffmpeg 刷盘
  await new Promise((r) => setTimeout(r, 800));

  if (!fs.existsSync(rec.file) || fs.statSync(rec.file).size < 1000) {
    console.warn(`[recorder] 文件无效，跳过 ${makeBatchId}`);
    return;
  }

  const trimmed = path.join(CONFIG.workDir, `${makeBatchId}-out.mp4`);
  let meta = { duration: 0, trimmed: false };
  try {
    meta = trimVideo(rec.file, trimmed);
  } catch (e) {
    console.warn('[recorder] 裁剪失败，用原片', e.message);
    fs.copyFileSync(rec.file, trimmed);
  }

  const buf = fs.readFileSync(trimmed);
  const data = await request('POST', `/api/admin/videos/upload?makeBatchId=${encodeURIComponent(makeBatchId)}`, {
    rawBody: buf,
    headers: { 'Content-Type': 'video/mp4' },
  });
  console.log(`[recorder] 上传成功 ${makeBatchId} → ${data.videoUrl} (绑定 ${data.boundOrders} 单)`);

  try {
    fs.unlinkSync(rec.file);
    fs.unlinkSync(trimmed);
  } catch {
    /* ignore */
  }
}

async function tick() {
  const jobs = await request('GET', '/api/admin/record-jobs');
  const activeIds = new Set((jobs.active || []).map((j) => j.makeBatchId));

  for (const job of jobs.active || []) {
    if (!recording.has(job.makeBatchId)) startRecord(job.makeBatchId);
  }

  // 本地正在录、但服务端已不在 active → 结束上传
  for (const id of [...recording.keys()]) {
    if (!activeIds.has(id)) await finalize(id);
  }

  // 兜底：finalize 列表（服务端认为该结束且无视频）
  for (const job of jobs.finalize || []) {
    if (recording.has(job.makeBatchId)) await finalize(job.makeBatchId);
  }
}

async function main() {
  console.log('四季果先 · RTSP 录像助手');
  console.log(`API: ${CONFIG.apiBase}`);
  if (!CONFIG.rtspUrl) {
    console.error('请在 recorder/.env 填写 RTSP_URL');
    process.exit(1);
  }
  if (!whichFfmpeg()) {
    console.error('未找到 ffmpeg，请先安装：sudo apt install ffmpeg');
    process.exit(1);
  }
  await login();
  console.log('开始轮询制作批次…');
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.warn('[recorder]', e.message);
      if (/登录|过期|权限|401/.test(e.message)) {
        try {
          await login();
        } catch (e2) {
          console.warn('重新登录失败', e2.message);
        }
      }
    }
    await new Promise((r) => setTimeout(r, CONFIG.pollMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
