#!/usr/bin/env node
/**
 * 向已有库追加「水果捞」系列（幂等：已有则跳过）
 * 用法：node server/scripts/add-fruit-mix-products.js
 */
const crypto = require('crypto');
const { load, save, fruitMixProducts, DRIVER } = require('../src/db');

async function main() {
  const db = await load();
  const has = (db.products || []).some((p) => p.category === '水果捞');
  if (has) {
    console.log('水果捞已存在，跳过');
    return;
  }
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const img = (name) => `/assets/products/menu/${name}`;
  db.products = [...(db.products || []), ...fruitMixProducts(now, uid, img)];
  db.products.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  await save(db);
  const added = db.products.filter((p) => p.category === '水果捞');
  console.log(`已追加 ${added.length} 个水果捞商品 (${DRIVER})`);
  added.forEach((p) => {
    const prices = (p.specs || []).map((s) => `${s.name}¥${s.price}`).join('/');
    console.log(`  · ${p.name} ${prices}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
