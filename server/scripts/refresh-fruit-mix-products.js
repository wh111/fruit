#!/usr/bin/env node
/**
 * 替换「水果捞」系列为市面流行款（删旧上新，保留其他品类）
 * 用法：node server/scripts/refresh-fruit-mix-products.js
 */
const crypto = require('crypto');
const { load, save, fruitMixProducts, DRIVER } = require('../src/db');

async function main() {
  const db = await load();
  const kept = (db.products || []).filter((p) => p.category !== '水果捞');
  const removed = (db.products || []).length - kept.length;
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const img = (name) => `/assets/products/menu/${name}`;
  const fresh = fruitMixProducts(now, uid, img);
  db.products = [...kept, ...fresh].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  await save(db);
  console.log(`水果捞已刷新 (${DRIVER})：移除 ${removed} 个，新增 ${fresh.length} 个`);
  fresh.forEach((p) => {
    const prices = (p.specs || []).map((s) => `${s.name}¥${s.price}`).join('/');
    console.log(`  · ${p.name} ${prices}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
