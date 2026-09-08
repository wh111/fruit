/**
 * 提前预定批次（Asia/Shanghai）
 * 仅两个批次：
 * - 11:00 前预定，12:00 取餐
 * - 17:00 前预定，18:00 取餐
 * 现作现取为补充；优惠走优惠券
 */
const TZ = '+08:00';
const LUNCH_ORDER_BEFORE = 11 * 60;
const LUNCH_PICKUP = 12 * 60;
const EVENING_ORDER_BEFORE = 17 * 60;
const EVENING_PICKUP = 18 * 60;

function pad(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function shopParts(ms = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return { y, m, d, hour, minute, minutes: hour * 60 + minute };
}

function shopStamp(y, m, d, hour, minute) {
  return new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00${TZ}`).getTime();
}

function todayKey(ms = Date.now()) {
  const p = shopParts(ms);
  return `${p.y}${pad(p.m)}${pad(p.d)}`;
}

function formatHm(ms) {
  const p = shopParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function formatPickupLabel(ms) {
  if (!ms) return '';
  const p = shopParts(ms);
  return `${p.m}月${p.d}日 ${pad(p.hour)}:${pad(p.minute)}`;
}

function parsePickupAt(input, now = Date.now()) {
  if (input == null || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim();
  if (/^\d{10,13}$/.test(s)) return Number(s);
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const p = shopParts(now);
    return shopStamp(p.y, p.m, p.d, Number(hm[1]), Number(hm[2]));
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function batchDefs(now = Date.now()) {
  const n = shopParts(now);
  return [
    {
      code: 'lunch',
      orderBefore: LUNCH_ORDER_BEFORE,
      pickupMinutes: LUNCH_PICKUP,
      time: '12:00',
      pickupAt: shopStamp(n.y, n.m, n.d, 12, 0),
      label: '12:00 取餐',
      reason: '11:00 前预定，12:00 取餐',
    },
    {
      code: 'evening',
      orderBefore: EVENING_ORDER_BEFORE,
      pickupMinutes: EVENING_PICKUP,
      time: '18:00',
      pickupAt: shopStamp(n.y, n.m, n.d, 18, 0),
      label: '18:00 取餐',
      reason: '17:00 前预定，18:00 取餐',
    },
  ];
}

function matchBatch(pickupAt, now = Date.now()) {
  if (!pickupAt) return null;
  const p = shopParts(pickupAt);
  const n = shopParts(now);
  if (!(n.y === p.y && n.m === p.m && n.d === p.d)) return null;
  return batchDefs(now).find((b) => Math.abs(p.minutes - b.pickupMinutes) <= 1) || null;
}

function buildSlots(now = Date.now()) {
  const n = shopParts(now);
  return batchDefs(now)
    .filter((b) => n.minutes < b.orderBefore)
    .map((b) => ({
      pickupAt: b.pickupAt,
      time: b.time,
      code: b.code,
      discount: false,
      label: b.label,
    }));
}

/** @deprecated 预定不再打折；保留空实现兼容旧调用 */
function discountInfo() {
  return { rate: 0, code: '', label: '', reason: '优惠请使用优惠券' };
}

function applyDiscount(originalAmount, disc) {
  const original = round2(originalAmount);
  return {
    originalAmount: original,
    amount: original,
    discountAmount: 0,
    discountRate: 0,
    discountCode: '',
    discountLabel: '',
    discountReason: (disc && disc.reason) || '',
  };
}

function getPromoState(now = Date.now()) {
  const n = shopParts(now);
  const lunchOpen = n.minutes < LUNCH_ORDER_BEFORE;
  const eveningOpen = n.minutes < EVENING_ORDER_BEFORE;
  const slots = buildSlots(now);
  const banners = [];
  if (lunchOpen) banners.push('11 点前可预定 12 点取餐');
  if (eveningOpen) banners.push('5 点前可预定 6 点取餐');
  if (!lunchOpen && !eveningOpen) {
    banners.push('今日预定批次已结束，可现作现取');
  }
  let reserveDesc = '今日预定已结束';
  if (lunchOpen && eveningOpen) reserveDesc = '可选 12:00 / 18:00 取餐';
  else if (lunchOpen) reserveDesc = '11 点前预定，12 点取餐';
  else if (eveningOpen) reserveDesc = '5 点前预定，6 点取餐';
  return {
    now,
    lunchOpen,
    eveningOpen,
    discountRate: 0,
    slots,
    banners,
    hint: banners.join('；'),
    reserveDesc,
    rules: [
      '11:00 前可预定 12:00 取餐',
      '17:00 前可预定 18:00 取餐',
      '优惠请使用优惠券；预定可用预定立减券',
    ],
  };
}

function normalizeFulfillment({ fulfillmentType, pickupAt, now = Date.now() }) {
  const type = fulfillmentType === 'reserve' ? 'reserve' : 'now';
  if (type === 'now') {
    return { fulfillmentType: 'now', pickupAt: null };
  }
  const ts = parsePickupAt(pickupAt, now);
  if (!ts) {
    throw Object.assign(new Error('请选择取餐时间'), { status: 400 });
  }
  const batch = matchBatch(ts, now);
  if (!batch) {
    throw Object.assign(new Error('仅可预定 12:00 或 18:00 取餐'), { status: 400 });
  }
  const n = shopParts(now);
  if (n.minutes >= batch.orderBefore) {
    throw Object.assign(new Error(`${batch.time} 批次已截止预定`), { status: 400 });
  }
  return { fulfillmentType: 'reserve', pickupAt: batch.pickupAt };
}

module.exports = {
  DISCOUNT_RATE: 0,
  todayKey,
  shopParts,
  shopStamp,
  formatHm,
  formatPickupLabel,
  parsePickupAt,
  discountInfo,
  applyDiscount,
  buildSlots,
  getPromoState,
  normalizeFulfillment,
  round2,
};
