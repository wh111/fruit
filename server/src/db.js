const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaultDb = () => ({
  products: [],
  orders: [],
  users: [],
  settings: {
    shopName: '四季果先',
    shopPhone: '',
    pickupHint: '做好后请到柜台取餐，出示取餐码即可',
  },
  seq: { orderDay: '', pickupNo: 0 },
});

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    seedProducts(db);
    save(db);
  }
}

function load() {
  ensure();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function seedProducts(db) {
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  db.products = [
    {
      id: uid(),
      name: '缤纷水果杯',
      desc: '当季鲜切：西瓜、哈密瓜、猕猴桃、葡萄',
      cover: '/uploads/demo-mix.svg',
      category: '经典果切',
      status: 1,
      sort: 1,
      specs: [
        { id: 's', name: '小杯', price: 12.9, stock: 999 },
        { id: 'm', name: '中杯', price: 18.9, stock: 999 },
        { id: 'l', name: '大杯', price: 25.9, stock: 999 },
      ],
      extras: [
        { id: 'honey', name: '蜂蜜', price: 1 },
        { id: 'yogurt', name: '酸奶', price: 2 },
        { id: 'oats', name: '燕麦脆', price: 2 },
      ],
      createdAt: now,
    },
    {
      id: uid(),
      name: '热带果切',
      desc: '芒果、火龙果、菠萝、百香果',
      cover: '/uploads/demo-tropical.svg',
      category: '经典果切',
      status: 1,
      sort: 2,
      specs: [
        { id: 's', name: '小杯', price: 15.9, stock: 999 },
        { id: 'm', name: '中杯', price: 22.9, stock: 999 },
        { id: 'l', name: '大杯', price: 29.9, stock: 999 },
      ],
      extras: [
        { id: 'coconut', name: '椰奶', price: 2 },
        { id: 'chia', name: '奇亚籽', price: 1.5 },
      ],
      createdAt: now,
    },
    {
      id: uid(),
      name: '莓果轻食盒',
      desc: '蓝莓、草莓、树莓，低糖轻负担',
      cover: '/uploads/demo-berry.svg',
      category: '轻食盒',
      status: 1,
      sort: 3,
      specs: [
        { id: 's', name: '单人盒', price: 19.9, stock: 999 },
        { id: 'm', name: '双人盒', price: 32.9, stock: 999 },
      ],
      extras: [
        { id: 'yogurt', name: '希腊酸奶', price: 3 },
        { id: 'nuts', name: '坚果碎', price: 3 },
      ],
      createdAt: now,
    },
    {
      id: uid(),
      name: '四季拼盘',
      desc: '四色果切拼盘，适合分享',
      cover: '/uploads/demo-platter.svg',
      category: '分享装',
      status: 1,
      sort: 4,
      specs: [
        { id: 'm', name: '标准拼', price: 48, stock: 999 },
        { id: 'l', name: '豪华拼', price: 68, stock: 999 },
      ],
      extras: [],
      createdAt: now,
    },
  ];
}

module.exports = { load, save, ensure, DATA_DIR, DB_FILE };
