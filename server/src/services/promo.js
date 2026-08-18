/**
 * 提前预定优惠（Asia/Shanghai）
 * 仅两个批次：
 * - 11:00 前预定，12:00 取餐：8 折
 * - 17:00 前预定，18:00 取餐：8 折
 * 现作现取：原价
 */
const TZ = '+08:00';
const DISCOUNT_RATE = 0.2;
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
      label: '12:00 取餐 · 8折',
      discountLabel: '11点前预定12点取 · 8折',
      reason: '11:00 前预定，12:00 取餐',
    },
    {
      code: 'evening',
      orderBefore: EVENING_ORDER_BEFORE,
      pickupMinutes: EVENING_PICKUP,
      time: '18:00',
      pickupAt: shopStamp(n.y, n.m, n.d, 18, 0),
      label: '18:00 取餐 · 8折',
      discountLabel: '5点前预定6点取 · 8折',
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
      discount: true,
      discountLabel: b.discountLabel,
      label: b.label,
    }));
}

function discountInfo({ fulfillmentType, pickupAt, now = Date.now() }) {
  if (fulfillmentType !== 'reserve' || !pickupAt) {
    return { rate: 0, code: '', label: '', reason: '现作现取不享受提前预定优惠' };
  }
  const n = shopParts(now);
  const batch = matchBatch(pickupAt, now);
  if (!batch) {
    return { rate: 0, code: '', label: '', reason: '仅可预定 12:00 或 18:00 取餐' };
  }
  if (n.minutes >= batch.orderBefore) {
    return { rate: 0, code: '', label: '', reason: `${batch.time} 批次已截止预定` };
  }
  return {
    rate: DISCOUNT_RATE,
    code: batch.code,
    label: batch.discountLabel,
    reason: batch.reason,
  };
}

function applyDiscount(originalAmount, disc) {
  const original = round2(originalAmount);
  if (!disc || !disc.rate) {
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
  const amount = round2(original * (1 - disc.rate));
  return {
    originalAmount: original,
    amount,
    discountAmount: round2(original - amount),
    discountRate: disc.rate,
    discountCode: disc.code,
    discountLabel: disc.label,
    discountReason: disc.reason,
  };
}

function getPromoState(now = Date.now()) {
  const n = shopParts(now);
  const lunchOpen = n.minutes < LUNCH_ORDER_BEFORE;
  const eveningOpen = n.minutes < EVENING_ORDER_BEFORE;
  const slots = buildSlots(now);
  const banners = [];
  if (lunchOpen) banners.push('11 点前预定，12 点取餐享 8 折');
  if (eveningOpen) banners.push('5 点前预定，6 点取餐享 8 折');
  if (!lunchOpen && !eveningOpen) {
    banners.push('现作现取为原价；今日预定批次已结束');
  }
  let reserveDesc = '今日预定已结束';
  if (lunchOpen && eveningOpen) reserveDesc = '仅 12 点或 6 点取餐，享 8 折';
  else if (lunchOpen) reserveDesc = '11 点前预定，12 点取餐 8 折';
  else if (eveningOpen) reserveDesc = '5 点前预定，6 点取餐 8 折';
  return {
    now,
    lunchOpen,
    eveningOpen,
    discountRate: DISCOUNT_RATE,
    slots,
    banners,
    hint: banners.filter((b) => !b.includes('原价')).join('；') || banners[0] || '',
    reserveDesc,
    rules: ['11:00 前预定，12:00 取餐 8 折', '17:00 前预定，18:00 取餐 8 折', '现作现取不享受优惠'],
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
  DISCOUNT_RATE,
  todayKey,
  shopParts,
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
