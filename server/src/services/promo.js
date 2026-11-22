/**
 * 提前预定批次（Asia/Shanghai）
 * 午/晚各两档，照顾下班早晚：
 * - 11:00 前预定 → 11:40 或 12:00 取餐
 * - 17:00 前预定 → 17:40 或 18:00 取餐
 * 现作现取为补充；优惠走优惠券
 */
const TZ = '+08:00';
const LUNCH_ORDER_BEFORE = 11 * 60;
const EVENING_ORDER_BEFORE = 17 * 60;

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

/** 门店时区星期：0=周日 … 5=周五 … 6=周六 */
function shopWeekday(ms = Date.now()) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(new Date(ms));
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[s] ?? -1;
}

function isShopFriday(ms = Date.now()) {
  return shopWeekday(ms) === 5;
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
      code: 'lunch-40',
      orderBefore: LUNCH_ORDER_BEFORE,
      pickupMinutes: 11 * 60 + 40,
      time: '11:40',
      pickupAt: shopStamp(n.y, n.m, n.d, 11, 40),
      label: '11:40 取餐（偏早）',
      reason: '11:00 前预定，11:40 取餐',
    },
    {
      code: 'lunch-hour',
      orderBefore: LUNCH_ORDER_BEFORE,
      pickupMinutes: 12 * 60,
      time: '12:00',
      pickupAt: shopStamp(n.y, n.m, n.d, 12, 0),
      label: '12:00 取餐（偏晚）',
      reason: '11:00 前预定，12:00 取餐',
    },
    {
      code: 'evening-40',
      orderBefore: EVENING_ORDER_BEFORE,
      pickupMinutes: 17 * 60 + 40,
      time: '17:40',
      pickupAt: shopStamp(n.y, n.m, n.d, 17, 40),
      label: '17:40 取餐（偏早）',
      reason: '17:00 前预定，17:40 取餐',
    },
    {
      code: 'evening-hour',
      orderBefore: EVENING_ORDER_BEFORE,
      pickupMinutes: 18 * 60,
      time: '18:00',
      pickupAt: shopStamp(n.y, n.m, n.d, 18, 0),
      label: '18:00 取餐（偏晚）',
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

/** 默认支持预定的大分类（水果零售等成品永不参与预定） */
const DEFAULT_RESERVE_CATEGORIES = ['果切系列', '酸奶捞', '网红小吃', '新鲜现剥', '水果捞', '鲜榨果汁'];

/** 永不支持预定的分类（成品零售现取） */
const NO_RESERVE_CATEGORIES = new Set(['免洗什锦', '水果零售', '零售什锦']);

/** 管理端可选的全部大分类（不含水果零售） */
const ALL_PRODUCT_CATEGORIES = [
  '酸奶捞',
  '网红小吃',
  '新鲜现剥',
  '果切系列',
  '鲜榨果汁',
  '水果捞',
  '热果奶',
  '经典热饮',
];

function isNoReserveCategory(category) {
  return NO_RESERVE_CATEGORIES.has(String(category || '').trim());
}

function getReserveCategories(db) {
  const raw = db && db.settings && db.settings.reserveCategories;
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x || '').trim()).filter(Boolean)
    : DEFAULT_RESERVE_CATEGORIES.slice();
  return list.filter((c) => !isNoReserveCategory(c));
}

function setReserveCategories(db, list) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const allowed = new Set(ALL_PRODUCT_CATEGORIES);
  const next = (Array.isArray(list) ? list : [])
    .map((x) => String(x || '').trim())
    .filter((x) => x && allowed.has(x) && !isNoReserveCategory(x));
  // 去重保序
  const seen = new Set();
  db.settings.reserveCategories = next.filter((x) => {
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
  return db.settings.reserveCategories;
}

function categoryAllowsReserve(db, category) {
  const cat = String(category || '').trim();
  if (!cat || isNoReserveCategory(cat)) return false;
  return getReserveCategories(db).includes(cat);
}

function getPromoState(now = Date.now(), db = null) {
  const n = shopParts(now);
  const lunchOpen = n.minutes < LUNCH_ORDER_BEFORE;
  const eveningOpen = n.minutes < EVENING_ORDER_BEFORE;
  const slots = buildSlots(now);
  const banners = [];
  if (lunchOpen) banners.push('11 点前可预定 11:40 或 12:00 取餐');
  if (eveningOpen) banners.push('5 点前可预定 17:40 或 18:00 取餐');
  if (!lunchOpen && !eveningOpen) {
    banners.push('今日预定批次已结束，可现作现取');
  }
  let reserveDesc = '今日预定已结束';
  if (lunchOpen && eveningOpen) {
    reserveDesc = '可选 11:40 / 12:00 / 17:40 / 18:00（照顾下班早晚）';
  } else if (lunchOpen) {
    reserveDesc = '11 点前预定，可选 11:40 或 12:00 取餐';
  } else if (eveningOpen) {
    reserveDesc = '5 点前预定，可选 17:40 或 18:00 取餐';
  }
  const reserveCategories = getReserveCategories(db);
  return {
    now,
    lunchOpen,
    eveningOpen,
    discountRate: 0,
    slots,
    banners,
    hint: banners.join('；'),
    reserveDesc,
    reserveCategories,
    rules: [
      '11:00 前可预定：11:40（偏早）或 12:00（偏晚）取餐',
      '17:00 前可预定：17:40（偏早）或 18:00（偏晚）取餐',
      '优惠请使用优惠券；预定可用预定立减券',
      '仅支持预定的商品分类可选提前预定',
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
    throw Object.assign(new Error('仅可预定 11:40 / 12:00 / 17:40 / 18:00 取餐'), { status: 400 });
  }
  const n = shopParts(now);
  if (n.minutes >= batch.orderBefore) {
    throw Object.assign(new Error(`${batch.time} 批次已截止预定`), { status: 400 });
  }
  return { fulfillmentType: 'reserve', pickupAt: batch.pickupAt };
}

module.exports = {
  DISCOUNT_RATE: 0,
  DEFAULT_RESERVE_CATEGORIES,
  ALL_PRODUCT_CATEGORIES,
  todayKey,
  shopParts,
  shopWeekday,
  isShopFriday,
  shopStamp,
  formatHm,
  formatPickupLabel,
  parsePickupAt,
  discountInfo,
  applyDiscount,
  buildSlots,
  getPromoState,
  getReserveCategories,
  setReserveCategories,
  categoryAllowsReserve,
  normalizeFulfillment,
  round2,
};
