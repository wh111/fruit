/**
 * 健康代餐 · 小食套餐（结账可选加购）
 * 蛋白一份 + 主食 100g 一份
 */
const DEFAULT_SIDE_MEAL = {
  enabled: true,
  title: '加一份现烤小食',
  subtitle: '现烤鸡胸 / 罗非鱼排 + 蜜薯，出炉现热 · 配果切刚好',
  /** 可加购的商品大分类 */
  categories: ['酸奶捞', '网红小吃', '新鲜现剥', '果切系列', '鲜榨果汁', '水果捞', '热果奶', '经典热饮'],
  /**
   * 当前剩余可售份数（按柜台现烤存量，非按日清零）；
   * null/undefined = 不限量。下单自动减 1，烤完可在后台再加。
   */
  stock: 20,
  proteins: [
    {
      id: 'protein-chicken-zero',
      name: '鸡胸·0脂',
      weight: '100g',
      tag: '强烈推荐',
      recommend: true,
      proteinG: 15,
      carbG: 5,
      price: 12.9,
      originalPrice: 15.9,
      enabled: true,
    },
    {
      id: 'protein-chicken-orleans',
      name: '鸡胸·奥尔良',
      weight: '100g',
      tag: '',
      recommend: false,
      proteinG: 15,
      carbG: 5,
      price: 12.9,
      originalPrice: 15.9,
      enabled: true,
    },
    {
      id: 'protein-tilapia-garlic',
      name: '罗非鱼排·蒜蓉',
      weight: '100g',
      tag: '',
      recommend: false,
      proteinG: 12.9,
      carbG: 5,
      price: 15.9,
      originalPrice: 18.9,
      enabled: true,
    },
    {
      id: 'protein-tilapia-pepper',
      name: '罗非鱼排·黑椒',
      weight: '100g',
      tag: '',
      recommend: false,
      proteinG: 12.9,
      carbG: 5,
      price: 15.9,
      originalPrice: 18.9,
      enabled: true,
    },
  ],
  carbs: [
    { id: 'carb-sweet-potato', name: '蜜薯', weight: '100g', enabled: true },
  ],
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseStock(raw) {
  if (raw == null || raw === '') return null;
  if (raw === false) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function ensureSideMeal(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  // 仅在配置缺失时播种；空 proteins/carbs 视为后台已清空，禁止回填默认项
  if (!db.settings.sideMeal || typeof db.settings.sideMeal !== 'object') {
    db.settings.sideMeal = JSON.parse(JSON.stringify(DEFAULT_SIDE_MEAL));
  }
  const cfg = db.settings.sideMeal;
  if (!Array.isArray(cfg.proteins)) {
    cfg.proteins = DEFAULT_SIDE_MEAL.proteins.map((x) => ({ ...x }));
  }
  if (!Array.isArray(cfg.carbs)) {
    cfg.carbs = DEFAULT_SIDE_MEAL.carbs.map((x) => ({ ...x }));
  }
  if (!Array.isArray(cfg.categories) || !cfg.categories.length) {
    cfg.categories = DEFAULT_SIDE_MEAL.categories.slice();
  }
  if (!cfg.title) cfg.title = DEFAULT_SIDE_MEAL.title;
  if (!cfg.subtitle) cfg.subtitle = DEFAULT_SIDE_MEAL.subtitle;
  if (cfg.enabled == null) cfg.enabled = true;
  if (!Object.prototype.hasOwnProperty.call(cfg, 'stock')) {
    cfg.stock = DEFAULT_SIDE_MEAL.stock;
  } else if (cfg.stock != null) {
    cfg.stock = parseStock(cfg.stock);
  }
  // 兼容旧数据：补齐原价 / 营养数字
  for (const p of cfg.proteins || []) {
    if (!p) continue;
    const price = round2(Number(p.price) || 0);
    p.price = price;
    const orig = Number(p.originalPrice);
    p.originalPrice = Number.isFinite(orig) && orig > 0 ? round2(orig) : price;
    if (p.proteinG != null) p.proteinG = round2(p.proteinG);
    if (p.carbG != null) p.carbG = round2(p.carbG);
    if (p.tag == null) p.tag = '';
    if (p.recommend == null) p.recommend = false;
  }
  return cfg;
}

function getSideMealConfig(db) {
  return ensureSideMeal(db);
}

function getSideMealStock(db) {
  const cfg = ensureSideMeal(db);
  return cfg.stock == null ? null : parseStock(cfg.stock);
}

function isSideMealSoldOut(db) {
  const stock = getSideMealStock(db);
  return stock != null && stock <= 0;
}

function categoryAllowsSideMeal(db, category) {
  const cfg = ensureSideMeal(db);
  if (!cfg.enabled) return false;
  const cat = String(category || '').trim();
  if (!cat) return false;
  return (cfg.categories || []).includes(cat);
}

function nutritionTipOf(p) {
  const bits = [];
  if (p.proteinG != null && Number(p.proteinG) > 0) bits.push(`蛋白${round2(p.proteinG)}g`);
  if (p.carbG != null && Number(p.carbG) >= 0) bits.push(`碳水${round2(p.carbG)}g`);
  return bits.join(' · ');
}

function mapPublicProteins(cfg) {
  return (cfg.proteins || [])
    .filter((p) => p && p.enabled !== false)
    .map((p) => {
      const price = round2(p.price);
      const originalPrice = round2(Number(p.originalPrice) > 0 ? p.originalPrice : p.price);
      const onSale = originalPrice > price;
      const nutritionTip = nutritionTipOf(p);
      return {
        id: p.id,
        name: p.name,
        weight: p.weight || '',
        tag: p.tag || (p.recommend ? '强烈推荐' : ''),
        recommend: !!p.recommend,
        proteinG: p.proteinG != null ? round2(p.proteinG) : null,
        carbG: p.carbG != null ? round2(p.carbG) : null,
        nutritionTip,
        price,
        originalPrice,
        onSale,
        label: onSale
          ? `${p.name}${p.weight || ''} ¥${price}（原价¥${originalPrice}）`
          : `${p.name}${p.weight || ''} ¥${price}`,
      };
    });
}

function mapPublicCarbs(cfg) {
  return (cfg.carbs || [])
    .filter((c) => c && c.enabled !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      weight: c.weight || '100g',
      label: `${c.name}${c.weight ? c.weight : ''}`,
    }));
}

/**
 * category 有值：按分类判断 allowed。
 * category 空：若总开关开启则返回完整选项 + categories，由小程序按本单分类自行判断。
 * 注意：总开关开启时 enabled 恒为 true，勿因分类不匹配把 enabled 打成 false（易误导前端）。
 */
function publicSideMeal(db, category) {
  const cfg = ensureSideMeal(db);
  const categories = Array.isArray(cfg.categories) ? cfg.categories.slice() : [];
  const stock = cfg.stock == null ? null : parseStock(cfg.stock);
  const soldOut = stock != null && stock <= 0;
  const base = {
    enabled: !!cfg.enabled,
    categories,
    title: cfg.title,
    subtitle: cfg.subtitle,
    stock,
    soldOut,
  };
  if (!cfg.enabled || soldOut) {
    return { ...base, allowed: false, proteins: [], carbs: [] };
  }
  const proteins = mapPublicProteins(cfg);
  const carbs = mapPublicCarbs(cfg);
  const cat = String(category || '').trim();
  if (!cat) {
    return { ...base, allowed: true, proteins, carbs };
  }
  const allowed = categories.includes(cat);
  if (!allowed) {
    return { ...base, allowed: false, proteins: [], carbs: [] };
  }
  return { ...base, allowed: true, proteins, carbs };
}

function assertSideMealInStock(db) {
  if (isSideMealSoldOut(db)) {
    throw Object.assign(new Error('现烤小食暂时售罄'), { status: 400 });
  }
}

/**
 * 支付成功后占用当前剩余（有限量时）。
 * 请取餐 / 取消 时再 restore，便于烤盘周转。
 */
function consumeSideMealStock(db, order) {
  if (!order || !order.sideMeal) return false;
  if (order.sideMealStockConsumed) return false;
  const cfg = ensureSideMeal(db);
  if (cfg.stock == null) {
    order.sideMealStockConsumed = true;
    return false;
  }
  const left = parseStock(cfg.stock);
  if (left == null) return false;
  if (left <= 0) {
    throw Object.assign(new Error('现烤小食暂时售罄'), { status: 400 });
  }
  cfg.stock = left - 1;
  order.sideMealStockConsumed = true;
  return true;
}

/**
 * 请取餐或取消时释放占用（仅曾扣减过的订单）
 */
function restoreSideMealStock(db, order) {
  if (!order || !order.sideMeal || !order.sideMealStockConsumed) return false;
  const cfg = ensureSideMeal(db);
  if (cfg.stock == null) {
    order.sideMealStockConsumed = false;
    return false;
  }
  cfg.stock = parseStock(cfg.stock) + 1;
  order.sideMealStockConsumed = false;
  return true;
}

/**
 * @param {object} db
 * @param {{ proteinId?: string, carbId?: string }|null} sel
 * @returns {null|{ id, name, proteinId, proteinName, carbId, carbName, price }}
 */
function resolveSideMeal(db, sel) {
  if (!sel || !sel.proteinId) return null;
  const cfg = ensureSideMeal(db);
  if (!cfg.enabled) return null;
  assertSideMealInStock(db);
  const protein = (cfg.proteins || []).find((p) => p && p.id === sel.proteinId && p.enabled !== false);
  if (!protein) {
    throw Object.assign(new Error('小食套餐蛋白选项无效'), { status: 400 });
  }
  const carbId = sel.carbId || (cfg.carbs || []).find((c) => c && c.enabled !== false)?.id;
  const carb = (cfg.carbs || []).find((c) => c && c.id === carbId && c.enabled !== false);
  if (!carb) {
    throw Object.assign(new Error('请选择小食套餐主食'), { status: 400 });
  }
  const price = round2(protein.price);
  const originalPrice = round2(
    Number(protein.originalPrice) > 0 ? protein.originalPrice : protein.price
  );
  const name = `${protein.name}${protein.weight || ''}+${carb.name}${carb.weight || '100g'}`;
  return {
    id: `${protein.id}_${carb.id}`,
    name,
    proteinId: protein.id,
    proteinName: protein.name,
    proteinWeight: protein.weight || '',
    carbId: carb.id,
    carbName: carb.name,
    carbWeight: carb.weight || '100g',
    price,
    originalPrice,
  };
}

function normalizeSideMealConfig(input = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SIDE_MEAL));
  const cfg = {
    enabled: input.enabled !== false && input.enabled !== 0,
    title: String(input.title || base.title).trim() || base.title,
    subtitle: String(input.subtitle || base.subtitle).trim() || base.subtitle,
    categories: Array.isArray(input.categories)
      ? [...new Set(input.categories.map((c) => String(c || '').trim()).filter(Boolean))]
      : base.categories.slice(),
    stock: Object.prototype.hasOwnProperty.call(input, 'stock')
      ? parseStock(input.stock)
      : base.stock,
    proteins: [],
    carbs: [],
  };
  if (!cfg.categories.length) cfg.categories = base.categories.slice();

  const proteinsIn = Array.isArray(input.proteins) ? input.proteins : base.proteins;
  cfg.proteins = proteinsIn
    .map((p, i) => {
      if (!p) return null;
      const name = String(p.name || '').trim();
      if (!name) return null;
      const id = String(p.id || `protein-${i + 1}`).trim() || `protein-${i + 1}`;
      const price = round2(Number(p.price) || 0);
      const origRaw = Number(p.originalPrice);
      const originalPrice =
        Number.isFinite(origRaw) && origRaw > 0 ? round2(origRaw) : price;
      const proteinGRaw = Number(p.proteinG);
      const carbGRaw = Number(p.carbG);
      return {
        id,
        name,
        weight: String(p.weight || '').trim(),
        tag: String(p.tag || '').trim(),
        recommend: !!(p.recommend || /强烈推荐|墙裂推荐/.test(String(p.tag || ''))),
        proteinG: Number.isFinite(proteinGRaw) && proteinGRaw > 0 ? round2(proteinGRaw) : null,
        carbG: Number.isFinite(carbGRaw) && carbGRaw >= 0 ? round2(carbGRaw) : null,
        price,
        originalPrice: Math.max(originalPrice, price),
        enabled: p.enabled !== false && p.enabled !== 0,
      };
    })
    .filter(Boolean);
  if (!cfg.proteins.length) {
    throw Object.assign(new Error('至少保留一个蛋白选项'), { status: 400 });
  }

  const carbsIn = Array.isArray(input.carbs) ? input.carbs : base.carbs;
  cfg.carbs = carbsIn
    .map((c, i) => {
      if (!c) return null;
      const name = String(c.name || '').trim();
      if (!name) return null;
      const id = String(c.id || `carb-${i + 1}`).trim() || `carb-${i + 1}`;
      return {
        id,
        name,
        weight: String(c.weight || '100g').trim() || '100g',
        enabled: c.enabled !== false && c.enabled !== 0,
      };
    })
    .filter(Boolean);
  if (!cfg.carbs.length) {
    throw Object.assign(new Error('至少保留一个主食选项'), { status: 400 });
  }
  return cfg;
}

function saveSideMealConfig(db, input) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  db.settings.sideMeal = normalizeSideMealConfig(input);
  return db.settings.sideMeal;
}

module.exports = {
  DEFAULT_SIDE_MEAL,
  ensureSideMeal,
  getSideMealConfig,
  getSideMealStock,
  isSideMealSoldOut,
  categoryAllowsSideMeal,
  publicSideMeal,
  resolveSideMeal,
  assertSideMealInStock,
  consumeSideMealStock,
  restoreSideMealStock,
  normalizeSideMealConfig,
  saveSideMealConfig,
  round2,
};
