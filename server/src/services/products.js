/**
 * 商品销量统计与列表排序
 * - 默认：按销量降序
 * - 某分类在 settings.productOrder[category] 保存过顺序后：按该顺序
 *
 * 封面缩略图：/assets/products/... → /assets/products/thumbs/{list|detail}/....jpg
 */

const path = require('path');
const fs = require('fs');

const CATEGORY_ORDER = ['酸奶捞', '网红小吃', '新鲜现剥', '果切系列', '免洗什锦', '水果捞', '热果奶', '经典热饮', '鲜榨果汁'];
const ROOT = path.join(__dirname, '..', '..', '..');

function productThumbPath(cover, size = 'list') {
  const raw = String(cover || '').trim();
  if (!raw || !raw.startsWith('/assets/products/')) return raw;
  if (raw.includes('/thumbs/')) return raw;
  const rest = raw.slice('/assets/products/'.length);
  const jpg = rest.replace(/\.(png|jpe?g|webp)$/i, '.jpg');
  const thumb = `/assets/products/thumbs/${size === 'detail' ? 'detail' : 'list'}/${jpg}`;
  const abs = path.join(ROOT, thumb.replace(/^\//, ''));
  if (fs.existsSync(abs)) return thumb;
  return raw;
}

function withCoverVariants(product) {
  const cover = product.cover || '';
  return {
    ...product,
    cover,
    coverList: productThumbPath(cover, 'list'),
    coverDetail: productThumbPath(cover, 'detail'),
  };
}

function isPaidLike(order) {
  if (!order) return false;
  return !['pending_pay', 'cancelled'].includes(order.status);
}

/** @returns {Record<string, number>} productId -> 售出件数 */
function computeProductSales(db) {
  const map = Object.create(null);
  for (const o of db.orders || []) {
    if (!isPaidLike(o)) continue;
    const items = Array.isArray(o.items) && o.items.length ? o.items : null;
    if (items) {
      for (const it of items) {
        if (!it || !it.productId || it.productId === 'cart' || it.productId === 'bulk') continue;
        const q = Math.max(1, Number(it.quantity) || 1);
        map[it.productId] = (map[it.productId] || 0) + q;
      }
    } else if (o.productId && o.productId !== 'bulk' && o.productId !== 'cart') {
      const q = Math.max(1, Number(o.quantity) || 1);
      map[o.productId] = (map[o.productId] || 0) + q;
    }
  }
  return map;
}

function withSales(product, salesMap) {
  const sales = (salesMap && salesMap[product.id]) || Number(product.salesCount) || 0;
  return { ...product, sales };
}

function compareBySales(a, b) {
  const salesA = Number(a.sales) || 0;
  const salesB = Number(b.sales) || 0;
  if (salesB !== salesA) return salesB - salesA;
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
}

function getProductOrderMap(db) {
  const raw = db && db.settings && db.settings.productOrder;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function orderCategoryItems(items, savedIds) {
  if (!Array.isArray(savedIds) || !savedIds.length) {
    return items.slice().sort(compareBySales);
  }
  const byId = new Map(items.map((p) => [p.id, p]));
  const ordered = [];
  const seen = new Set();
  for (const id of savedIds) {
    const p = byId.get(id);
    if (!p || seen.has(id)) continue;
    ordered.push(p);
    seen.add(id);
  }
  const rest = items.filter((p) => !seen.has(p.id)).sort(compareBySales);
  return ordered.concat(rest);
}

function listProductsSorted(db, { activeOnly = false } = {}) {
  const salesMap = computeProductSales(db);
  const orderMap = getProductOrderMap(db);
  const all = (db.products || [])
    .filter((p) => p && (!activeOnly || p.status === 1))
    .map((p) => withSales(p, salesMap));

  const byCat = new Map();
  for (const p of all) {
    const cat = String(p.category || '未分类');
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }

  const cats = [
    ...CATEGORY_ORDER.filter((c) => byCat.has(c)),
    ...[...byCat.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, 'zh')),
  ];

  const result = [];
  for (const cat of cats) {
    const items = byCat.get(cat) || [];
    const ordered = orderCategoryItems(items, orderMap[cat]);
    const manual = Array.isArray(orderMap[cat]) && orderMap[cat].length > 0;
    for (let i = 0; i < ordered.length; i += 1) {
      result.push({
        ...ordered[i],
        sort: (i + 1) * 10,
        sortMode: manual ? 'manual' : 'sales',
      });
    }
  }
  return result;
}

function listPublicProducts(db) {
  return listProductsSorted(db, { activeOnly: true }).map(withCoverVariants);
}

function listAdminProducts(db) {
  return listProductsSorted(db, { activeOnly: false }).map(withCoverVariants);
}

/**
 * 保存某分类手动顺序；ids 为空则恢复该分类按销量
 */
function saveCategoryProductOrder(db, category, ids) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.settings.productOrder || typeof db.settings.productOrder !== 'object') {
    db.settings.productOrder = {};
  }
  const cat = String(category || '').trim();
  if (!cat) throw Object.assign(new Error('请指定分类'), { status: 400 });

  if (!Array.isArray(ids) || !ids.length) {
    delete db.settings.productOrder[cat];
    return { category: cat, mode: 'sales', ids: [] };
  }

  const unique = [];
  const seen = new Set();
  for (const id of ids) {
    const sid = String(id || '').trim();
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    unique.push(sid);
  }
  db.settings.productOrder[cat] = unique;

  // 同步写回 sort，便于旧逻辑/导出兼容
  let n = 10;
  for (const id of unique) {
    const p = (db.products || []).find((x) => x && x.id === id);
    if (!p) continue;
    p.sort = n;
    n += 10;
  }
  return { category: cat, mode: 'manual', ids: unique };
}

module.exports = {
  CATEGORY_ORDER,
  productThumbPath,
  withCoverVariants,
  computeProductSales,
  withSales,
  compareBySales,
  getProductOrderMap,
  orderCategoryItems,
  listPublicProducts,
  listAdminProducts,
  saveCategoryProductOrder,
};
