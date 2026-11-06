/**
 * 销售日报（Asia/Shanghai）
 */
const { shopParts, round2 } = require('./promo');

const PAID = new Set(['paid', 'making', 'ready', 'done']);

function dateKeyFromMs(ms) {
  const p = shopParts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function dayStampStart(dateStr) {
  const s = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = new Date(`${s}T00:00:00+08:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dayStampEnd(dateStr) {
  const s = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = new Date(`${s}T23:59:59.999+08:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizePayChannel(order) {
  const ch = String(order.payChannel || order.payMode || '').toLowerCase();
  if (ch === 'balance') return 'balance';
  if (ch === 'wechat') return 'wechat';
  return 'other';
}

function emptyDay(date) {
  return {
    date,
    revenue: 0,
    orderCount: 0,
    byPayChannel: {
      wechat: { revenue: 0, orderCount: 0 },
      balance: { revenue: 0, orderCount: 0 },
      other: { revenue: 0, orderCount: 0 },
    },
    byProduct: {},
  };
}

function listDays(fromKey, toKey) {
  const out = [];
  let cur = dayStampStart(fromKey);
  const end = dayStampStart(toKey);
  if (cur == null || end == null) return out;
  while (cur <= end) {
    out.push(dateKeyFromMs(cur));
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}

function emptyPayChannels() {
  return {
    wechat: { revenue: 0, orderCount: 0 },
    balance: { revenue: 0, orderCount: 0 },
    other: { revenue: 0, orderCount: 0 },
  };
}

function accumulateOrder(bucket, order) {
  const amount = round2(order.amount);
  const qty = Math.max(1, Math.floor(Number(order.quantity) || 1));
  bucket.revenue = round2(bucket.revenue + amount);
  bucket.orderCount += 1;
  const ch = normalizePayChannel(order);
  bucket.byPayChannel[ch].revenue = round2(bucket.byPayChannel[ch].revenue + amount);
  bucket.byPayChannel[ch].orderCount += 1;
  const name = String(order.productName || '未知商品').trim() || '未知商品';
  if (!bucket.byProduct[name]) {
    bucket.byProduct[name] = { productName: name, quantity: 0, revenue: 0, orderCount: 0 };
  }
  bucket.byProduct[name].quantity += qty;
  bucket.byProduct[name].revenue = round2(bucket.byProduct[name].revenue + amount);
  bucket.byProduct[name].orderCount += 1;
}

function finalizeBucket(bucket, keyField, keyValue) {
  return {
    [keyField]: keyValue,
    revenue: bucket.revenue,
    orderCount: bucket.orderCount,
    byPayChannel: bucket.byPayChannel,
    byProduct: Object.values(bucket.byProduct).sort((a, b) => b.revenue - a.revenue),
  };
}

function summarizeList(list) {
  return list.reduce(
    (acc, d) => {
      acc.revenue = round2(acc.revenue + d.revenue);
      acc.orderCount += d.orderCount;
      for (const k of ['wechat', 'balance', 'other']) {
        acc.byPayChannel[k].revenue = round2(acc.byPayChannel[k].revenue + d.byPayChannel[k].revenue);
        acc.byPayChannel[k].orderCount += d.byPayChannel[k].orderCount;
      }
      return acc;
    },
    { revenue: 0, orderCount: 0, byPayChannel: emptyPayChannels() }
  );
}

function monthKeyFromDate(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function monthBounds(monthStr) {
  const m = String(monthStr || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return {
    from: `${m}-01`,
    to: `${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * @param {object} db
 * @param {{ from?: string, to?: string, groupBy?: 'day'|'month', month?: string }} opts
 */
function salesReport(db, opts = {}) {
  const today = dateKeyFromMs(Date.now());
  const groupBy = opts.groupBy === 'month' ? 'month' : 'day';
  let to = opts.to || today;
  let from = opts.from;

  if (opts.month) {
    const bounds = monthBounds(opts.month);
    if (bounds) {
      from = bounds.from;
      to = bounds.to;
    }
  }

  if (!from) {
    if (groupBy === 'month') {
      const endMs = dayStampStart(to) || Date.now();
      const p = shopParts(endMs);
      // 默认近 6 个自然月（含当月）
      let y = p.y;
      let m = p.m - 5;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      from = `${y}-${String(m).padStart(2, '0')}-01`;
    } else {
      const endMs = dayStampStart(to) || Date.now();
      from = dateKeyFromMs(endMs - 6 * 24 * 60 * 60 * 1000);
    }
  }
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }

  const rangeStart = dayStampStart(from);
  const rangeEnd = dayStampEnd(to);
  const dayMap = {};
  for (const d of listDays(from, to)) {
    dayMap[d] = emptyDay(d);
  }

  for (const o of db.orders || []) {
    if (!PAID.has(o.status)) continue;
    const t = o.paidAt || o.createdAt || 0;
    if (rangeStart != null && t < rangeStart) continue;
    if (rangeEnd != null && t > rangeEnd) continue;
    const key = dateKeyFromMs(t);
    if (!dayMap[key]) dayMap[key] = emptyDay(key);
    accumulateOrder(dayMap[key], o);
  }

  const days = Object.keys(dayMap)
    .sort()
    .reverse()
    .map((date) => finalizeBucket(dayMap[date], 'date', date));

  let months = [];
  if (groupBy === 'month') {
    const monthMap = {};
    for (const d of days) {
      const mk = monthKeyFromDate(d.date);
      if (!monthMap[mk]) {
        monthMap[mk] = {
          month: mk,
          revenue: 0,
          orderCount: 0,
          byPayChannel: emptyPayChannels(),
          byProduct: {},
        };
      }
      const bucket = monthMap[mk];
      bucket.revenue = round2(bucket.revenue + d.revenue);
      bucket.orderCount += d.orderCount;
      for (const k of ['wechat', 'balance', 'other']) {
        bucket.byPayChannel[k].revenue = round2(
          bucket.byPayChannel[k].revenue + d.byPayChannel[k].revenue
        );
        bucket.byPayChannel[k].orderCount += d.byPayChannel[k].orderCount;
      }
      for (const p of d.byProduct || []) {
        if (!bucket.byProduct[p.productName]) {
          bucket.byProduct[p.productName] = {
            productName: p.productName,
            quantity: 0,
            revenue: 0,
            orderCount: 0,
          };
        }
        const row = bucket.byProduct[p.productName];
        row.quantity += p.quantity;
        row.revenue = round2(row.revenue + p.revenue);
        row.orderCount += p.orderCount;
      }
    }
    months = Object.keys(monthMap)
      .sort()
      .reverse()
      .map((mk) => {
        const b = monthMap[mk];
        return {
          month: b.month,
          revenue: b.revenue,
          orderCount: b.orderCount,
          byPayChannel: b.byPayChannel,
          byProduct: Object.values(b.byProduct).sort((a, c) => c.revenue - a.revenue),
        };
      });
  }

  const rows = groupBy === 'month' ? months : days;
  const summary = summarizeList(rows);

  return {
    from,
    to,
    groupBy,
    summary,
    days,
    months,
  };
}

module.exports = {
  salesReport,
  dateKeyFromMs,
  monthBounds,
};
