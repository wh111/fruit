const crypto = require('crypto');

function defaultToppings() {
  const now = Date.now();
  // 葡萄干 / 两种燕麦免费；坚果按成本略分档
  return [
    { id: 'top-raisin', name: '葡萄干', spec: '一份', price: 0, status: 1, sort: 1, createdAt: now },
    { id: 'top-oat-cocoa', name: '榛子可可燕麦片', spec: '一份', price: 0, status: 1, sort: 2, createdAt: now },
    { id: 'top-oat-choco', name: '榛子巧克力燕麦', spec: '一份', price: 0, status: 1, sort: 3, createdAt: now },
    { id: 'top-cranberry', name: '蔓越莓干', spec: '一份', price: 2, status: 1, sort: 4, createdAt: now },
    { id: 'top-almond', name: '巴旦木仁', spec: '一份', price: 2, status: 1, sort: 5, createdAt: now },
    { id: 'top-cashew-white', name: '白腰果仁', spec: '一份', price: 3, status: 1, sort: 6, createdAt: now },
    { id: 'top-cashew-purple', name: '紫衣腰果仁', spec: '一份', price: 3, status: 1, sort: 7, createdAt: now },
    { id: 'top-pistachio', name: '开心果碎', spec: '一份', price: 4, status: 1, sort: 8, createdAt: now },
  ];
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeToppings(list) {
  if (!Array.isArray(list)) {
    throw Object.assign(new Error('小料列表格式不对'), { status: 400 });
  }
  return list.map((raw, index) => {
    const name = String(raw.name || '').trim();
    if (!name) throw Object.assign(new Error('请填写小料名称'), { status: 400 });
    const price = round2(raw.price);
    if (!Number.isFinite(price) || price < 0) {
      throw Object.assign(new Error(`${name} 的价格无效`), { status: 400 });
    }
    const spec = String(raw.spec || '').trim() || '一份';
    return {
      id: String(raw.id || '').trim() || crypto.randomUUID(),
      name,
      spec,
      price,
      status: raw.status === 0 || raw.status === '0' || raw.status === false ? 0 : 1,
      sort: index + 1,
      createdAt: Number(raw.createdAt) || Date.now(),
    };
  });
}

/** 顾客端：已上架小料（含 0 元免费） */
function listPublicToppings(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.status !== 0 && Number.isFinite(Number(t.price)) && Number(t.price) >= 0)
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((t) => ({
      id: t.id,
      name: t.name,
      spec: t.spec || '一份',
      price: round2(t.price),
    }));
}

/** 制作台：所有上架小料（含 0 元） */
function listActiveToppings(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.status !== 0)
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((t) => ({
      id: t.id,
      name: t.name,
      spec: t.spec || '一份',
      price: round2(t.price),
    }));
}

function findTopping(list, id) {
  return (Array.isArray(list) ? list : []).find((t) => t && t.id === id && t.status !== 0);
}

function resolveToppingItems(list, ids = []) {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    const t = findTopping(list, id);
    if (!t) continue;
    seen.add(id);
    out.push({
      id: t.id,
      name: t.name,
      spec: t.spec || '一份',
      price: round2(t.price),
    });
  }
  return out;
}

function isFruitBowlOrder(order) {
  if (!order) return false;
  const cat = String(order.productCategory || '');
  if (cat === '水果捞' || cat === '酸奶捞') return true;
  return /水果捞|捞$/.test(String(order.productName || ''));
}

module.exports = {
  defaultToppings,
  normalizeToppings,
  listPublicToppings,
  listActiveToppings,
  findTopping,
  resolveToppingItems,
  isFruitBowlOrder,
};
