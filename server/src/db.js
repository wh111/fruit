const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DRIVER = (process.env.DB_DRIVER || 'json').toLowerCase();

const defaultDb = () => ({
  products: [],
  orders: [],
  users: [],
  settings: {
    shopName: '四季果先',
    shopPhone: '',
    pickupHint: '做好后请到柜台取餐，出示取餐码即可',
    tagline: '办公室鲜果管家',
  },
  seq: { orderDay: '', pickupNo: 0 },
});

/** DIY 加料区（各品类可复用） */
const DIY_EXTRAS = [
  { id: 'nuts15', name: '坚果包15g', price: 3 },
  { id: 'chia5', name: '奇亚籽包5g', price: 2 },
  { id: 'oats15', name: '冷泡燕麦包15g', price: 3 },
  { id: 'nuts30', name: '双倍坚果包30g', price: 5 },
  { id: 'yogurt70', name: '酸奶杯70g', price: 5 },
  { id: 'chicken60', name: '即食鸡胸肉60g', price: 8 },
  { id: 'proteinbar', name: '蛋白棒1根', price: 10 },
];

function seedProducts(db) {
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const img = (name) => `/assets/products/menu/${name}`;

  db.products = [
    // —— 一、果切系列 ——
    {
      id: uid(),
      name: '招牌麒麟瓜',
      desc: '引流款，解渴解腻；每人限购1份',
      cover: img('fruit-kirin-melon.png'),
      category: '果切系列',
      status: 1,
      sort: 10,
      limitPerUser: 1,
      specs: [{ id: 'std', name: '350g', price: 5, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15', 'yogurt70'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '元气三拼',
      desc: '芒果+火龙果+哈密瓜，经典搭配',
      cover: img('fruit-yuanqi-trip.png'),
      category: '果切系列',
      status: 1,
      sort: 20,
      specs: [{ id: 'std', name: '250g', price: 15, stock: 999 }],
      extras: DIY_EXTRAS,
      createdAt: now,
    },
    {
      id: uid(),
      name: '热带风情',
      desc: '芒果+橙子+青提，酸甜开胃',
      cover: img('fruit-tropical.png'),
      category: '果切系列',
      status: 1,
      sort: 30,
      specs: [{ id: 'std', name: '250g', price: 15, stock: 999 }],
      extras: DIY_EXTRAS,
      createdAt: now,
    },
    {
      id: uid(),
      name: '红粉佳人',
      desc: '火龙果+草莓+猕猴桃，颜值担当',
      cover: img('fruit-pink-lady.png'),
      category: '果切系列',
      status: 1,
      sort: 40,
      specs: [{ id: 'std', name: '250g', price: 15, stock: 999 }],
      extras: DIY_EXTRAS,
      createdAt: now,
    },
    {
      id: uid(),
      name: '缤纷四拼',
      desc: '四种时令水果组合',
      cover: img('fruit-colorful-four.png'),
      category: '果切系列',
      status: 1,
      sort: 50,
      specs: [{ id: 'std', name: '350g', price: 20, stock: 999 }],
      extras: DIY_EXTRAS,
      createdAt: now,
    },

    // —— 二、冷食代餐碗 ——
    {
      id: uid(),
      name: '办公室饱腹杯',
      desc: '果切150g + 酸奶70g + 坚果包 · 下午茶小饿，约220大卡',
      cover: img('bowl-office-snack.png'),
      category: '冷食代餐碗',
      status: 1,
      sort: 110,
      specs: [{ id: 'std', name: '标准套', price: 18, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['chia5', 'oats15', 'nuts30'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '轻盈代餐碗',
      desc: '果切200g + 酸奶70g + 坚果包 + 奇亚籽包 · 午餐代餐，饱腹约4小时',
      cover: img('bowl-light-meal.png'),
      category: '冷食代餐碗',
      status: 1,
      sort: 120,
      specs: [{ id: 'std', name: '标准套', price: 25, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['oats15', 'nuts30', 'chicken60'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '高蛋白能量碗',
      desc: '果切150g + 酸奶70g + 坚果包 + 奇亚籽包 + 燕麦包 · 健身减脂，蛋白质约20g',
      cover: img('bowl-protein-energy.png'),
      category: '冷食代餐碗',
      status: 1,
      sort: 130,
      specs: [{ id: 'std', name: '标准套', price: 32, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['chicken60', 'proteinbar', 'nuts30'].includes(e.id)),
      createdAt: now,
    },

    // —— 三、暖腹代餐碗 ——
    {
      id: uid(),
      name: '经典暖腹碗',
      desc: '即食鸡胸肉100g + 果切150g + 坚果包 · 高蛋白低脂',
      cover: img('bowl-classic-warm.png'),
      category: '暖腹代餐碗',
      status: 1,
      sort: 210,
      specs: [{ id: 'std', name: '标准套', price: 28, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['yogurt70', 'chia5', 'proteinbar'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '暖饮暖腹碗',
      desc: '即食鸡胸肉60g + 果切100g + 热饮1杯 · 有肉有热饮',
      cover: img('bowl-warm-drink.png'),
      category: '暖腹代餐碗',
      status: 1,
      sort: 220,
      specs: [{ id: 'std', name: '标准套', price: 30, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15', 'yogurt70'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '双蛋白能量碗',
      desc: '即食鸡胸肉60g + 蛋白棒1根 + 果切120g · 蛋白质30g+，增肌减脂',
      cover: img('bowl-dual-protein.png'),
      category: '暖腹代餐碗',
      status: 1,
      sort: 230,
      specs: [{ id: 'std', name: '标准套', price: 35, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15', 'chia5', 'yogurt70'].includes(e.id)),
      createdAt: now,
    },

    // —— 四、热饮 · 热果奶 ——
    {
      id: uid(),
      name: '香蕉热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 香甜软糯，30秒出杯',
      cover: img('drink-banana-milk.png'),
      category: '热果奶',
      status: 1,
      sort: 310,
      specs: [{ id: 'std', name: '约300ml', price: 12, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '木瓜热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 果香四溢，暖心暖胃',
      cover: img('drink-papaya-milk.png'),
      category: '热果奶',
      status: 1,
      sort: 320,
      specs: [{ id: 'std', name: '约300ml', price: 14, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '草莓热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 冬日限定，少女心满满',
      cover: img('drink-strawberry-milk.png'),
      category: '热果奶',
      status: 1,
      sort: 330,
      specs: [{ id: 'std', name: '约300ml', price: 14, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15'].includes(e.id)),
      createdAt: now,
    },

    // —— 四、经典热饮 ——
    {
      id: uid(),
      name: '暖心热牛奶',
      desc: '浓郁香滑，暖胃暖心',
      cover: img('drink-hot-milk.png'),
      category: '经典热饮',
      status: 1,
      sort: 410,
      specs: [{ id: 'std', name: '1杯', price: 8, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '蜂蜜柚子茶',
      desc: '酸甜温润，VC满满',
      cover: img('drink-honey-pomelo.png'),
      category: '经典热饮',
      status: 1,
      sort: 420,
      specs: [{ id: 'std', name: '1杯', price: 10, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '苹果热橙茶',
      desc: '经典果茶，冬季热销',
      cover: img('drink-apple-orange.png'),
      category: '经典热饮',
      status: 1,
      sort: 430,
      specs: [{ id: 'std', name: '1杯', price: 12, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '经典热奶茶',
      desc: '香浓顺滑，温暖一整天',
      cover: img('drink-milk-tea.png'),
      category: '经典热饮',
      status: 1,
      sort: 440,
      specs: [{ id: 'std', name: '1杯', price: 12, stock: 999 }],
      extras: [],
      createdAt: now,
    },

    // —— 五、酸奶杯 ——
    {
      id: uid(),
      name: '奇亚籽酸奶杯',
      desc: '酸奶70g + 奇亚籽包5g · 高纤饱腹，开盖即食',
      cover: img('yogurt-chia.png'),
      category: '酸奶杯',
      status: 1,
      sort: 510,
      specs: [{ id: 'std', name: '标准杯', price: 8, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['nuts15', 'oats15'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '坚果酸奶杯',
      desc: '酸奶70g + 坚果包 · 优质脂肪，下午不困',
      cover: img('yogurt-nuts.png'),
      category: '酸奶杯',
      status: 1,
      sort: 520,
      specs: [{ id: 'std', name: '标准杯', price: 10, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['chia5', 'oats15'].includes(e.id)),
      createdAt: now,
    },
    {
      id: uid(),
      name: '双料满足杯',
      desc: '酸奶70g + 奇亚籽包 + 坚果包 · 双重口感，饱腹加倍',
      cover: img('yogurt-double.png'),
      category: '酸奶杯',
      status: 1,
      sort: 530,
      specs: [{ id: 'std', name: '标准杯', price: 12, stock: 999 }],
      extras: DIY_EXTRAS.filter((e) => ['oats15', 'nuts30'].includes(e.id)),
      createdAt: now,
    },
  ];
}

function ensureJson() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    seedProducts(db);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
}

async function ensure() {
  if (DRIVER === 'mysql') {
    const mysql = require('./db-mysql');
    await mysql.ensureMysql(seedProducts);
    return;
  }
  ensureJson();
}

async function load() {
  if (DRIVER === 'mysql') {
    const mysql = require('./db-mysql');
    return mysql.loadMysql();
  }
  ensureJson();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

async function save(db) {
  if (DRIVER === 'mysql') {
    const mysql = require('./db-mysql');
    await mysql.saveMysql(db);
    return;
  }
  ensureJson();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

module.exports = { load, save, ensure, seedProducts, DATA_DIR, DB_FILE, DRIVER, DIY_EXTRAS };
