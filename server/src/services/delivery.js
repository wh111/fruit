const { round2 } = require('./promo');

/** 内置送达点；费用/名称可在 settings.deliveryPoints 覆盖 */
const BASE_DELIVERY_POINTS = [
  { id: 'shop', name: '到店取', fee: 0, tip: '做好后来店取餐' },
  { id: 'a1', name: 'A座1号外卖柜', fee: 0.5, tip: '做好后放入外卖柜' },
  { id: 'b2', name: 'B座2号外卖柜', fee: 0.5, tip: '做好后放入外卖柜' },
];

const FALLBACK_DELIVERY_ID = 'shop';

function overridesMap(settings) {
  const raw = settings && settings.deliveryPoints;
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const map = {};
    for (const item of raw) {
      if (item && item.id) map[item.id] = item;
    }
    return map;
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function listDeliveryPoints(settings) {
  const o = overridesMap(settings);
  return BASE_DELIVERY_POINTS.map((base) => {
    const ov = o[base.id] || {};
    const enabled = ov.enabled === false ? false : true;
    const name =
      ov.name != null && String(ov.name).trim() ? String(ov.name).trim() : base.name;
    const tip = ov.tip != null && String(ov.tip).trim() ? String(ov.tip).trim() : base.tip;
    let fee = base.id === 'shop' ? 0 : round2(ov.fee != null ? Number(ov.fee) : base.fee);
    if (!Number.isFinite(fee) || fee < 0) fee = base.fee;
    return { id: base.id, name, fee, tip, enabled };
  }).filter((p) => p.enabled || p.id === 'shop');
}

function normalizeDelivery(deliveryPointId, settings) {
  const points = listDeliveryPoints(settings);
  const id = String(deliveryPointId || FALLBACK_DELIVERY_ID).trim() || FALLBACK_DELIVERY_ID;
  const point =
    points.find((p) => p.id === id) ||
    points.find((p) => p.id === FALLBACK_DELIVERY_ID) ||
    points[0];
  return {
    deliveryPoint: point.id,
    deliveryPointName: point.name,
    deliveryFee: round2(Number(point.fee) || 0),
    deliveryTip: point.tip || '',
  };
}

function deliveryNote(order) {
  if (!order) return '到店取';
  const name = order.deliveryPointName || (order.deliveryPoint === 'shop' ? '到店取' : '');
  if (!name || order.deliveryPoint === 'shop' || !order.deliveryPoint) return '到店取';
  const fee = Number(order.deliveryFee) > 0 ? `（配送费¥${order.deliveryFee}）` : '';
  return `投柜 ${name}${fee}`;
}

/** 保存后台配置：写入 settings.deliveryPoints（按 id 覆盖 fee/name/tip/enabled） */
function applyDeliverySettings(settings, pointsInput) {
  const next = { ...(settings || {}) };
  const map = { ...overridesMap(settings) };
  const list = Array.isArray(pointsInput) ? pointsInput : [];
  for (const item of list) {
    if (!item || !item.id) continue;
    if (!BASE_DELIVERY_POINTS.some((p) => p.id === item.id)) continue;
    const prev = map[item.id] || {};
    const patch = { ...prev };
    if (item.name != null) patch.name = String(item.name).trim();
    if (item.tip != null) patch.tip = String(item.tip).trim();
    if (item.enabled != null) patch.enabled = Boolean(item.enabled);
    if (item.id === 'shop') {
      patch.fee = 0;
    } else if (item.fee != null && item.fee !== '') {
      const fee = round2(Number(item.fee));
      if (!Number.isFinite(fee) || fee < 0) throw new Error(`无效配送费：${item.id}`);
      patch.fee = fee;
    }
    map[item.id] = patch;
  }
  next.deliveryPoints = map;
  return next;
}

module.exports = {
  BASE_DELIVERY_POINTS,
  DELIVERY_POINTS: BASE_DELIVERY_POINTS,
  FALLBACK_DELIVERY_ID,
  DEFAULT_DELIVERY_ID: FALLBACK_DELIVERY_ID,
  listDeliveryPoints,
  normalizeDelivery,
  deliveryNote,
  applyDeliverySettings,
};
