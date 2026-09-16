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
  coupons: [],
  settings: {
    shopName: '四季果先',
    shopPhone: '18813017847',
    // shopContact 仅内部备注，勿下发给用户端
    shopContact: '',
    pickupHint: '取餐前最多半小时现切，做好后请到柜台取餐，出示取餐码即可',
    tagline: '现切现做 · 新鲜半小时',
    groupBuyHint: '企业团购、部门下午茶、会议用果，电话沟通即可。10 份起订，可按 12:00 / 18:00 取餐。',
  },
  seq: { orderDay: '', pickupNo: 0 },
});

/** 加料已取消，保留空列表兼容下单逻辑 */
const DIY_EXTRAS = [];

/** 水果捞系列（市面流行款，客单价 ¥22–28） */
function fruitMixProducts(now, uid, img) {
  return [
    {
      id: uid(),
      name: '招牌酸奶水果捞',
      desc: '浓稠原味酸奶+三种时令水果，透明碗装',
      cover: img('mix-yogurt-fruit.png'),
      category: '水果捞',
      status: 1,
      sort: 200,
      specs: [
        { id: 'std', name: '中份', price: 22, stock: 999 },
        { id: 'lg', name: '大份', price: 28, stock: 999 },
      ],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '椰奶西米捞',
      desc: '生椰乳底+西米+芒果西瓜，清凉解腻',
      cover: img('mix-coconut-sago.png'),
      category: '水果捞',
      status: 1,
      sort: 210,
      specs: [{ id: 'std', name: '中份', price: 24, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '杨枝甘露捞',
      desc: '芒果泥+西柚粒+西米+椰奶，经典港式',
      cover: img('mix-mango-pomelo.png'),
      category: '水果捞',
      status: 1,
      sort: 220,
      specs: [{ id: 'std', name: '中份', price: 26, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '芋圆烧仙草捞',
      desc: '手作芋圆+烧仙草+水果，Q弹有层次',
      cover: img('mix-taro-grassjelly.png'),
      category: '水果捞',
      status: 1,
      sort: 230,
      specs: [{ id: 'std', name: '中份', price: 26, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '血糯米酸奶捞',
      desc: '血糯米垫底+酸奶+水果，饱腹下午茶',
      cover: img('mix-purple-rice.png'),
      category: '水果捞',
      status: 1,
      sort: 240,
      specs: [{ id: 'std', name: '中份', price: 28, stock: 999 }],
      extras: [],
      createdAt: now,
    },
  ];
}

function seedProducts(db) {
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const img = (name) => `/assets/products/menu/${name}`;

  db.products = [
    // —— 一、果切系列（按市面热销优先排） ——
    {
      id: uid(),
      name: '招牌麒麟瓜',
      desc: '无黑籽约500g，圆顶大杯；每人限购1份',
      cover: img('fruit-kirin-melon.png'),
      category: '果切系列',
      status: 1,
      sort: 10,
      limitPerUser: 1,
      specs: [{ id: 'std', name: '500g', price: 10, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '芒果多多',
      desc: '整杯芒果丁约250g，办公室TOP款',
      cover: img('fruit-mango-cup.png'),
      category: '果切系列',
      status: 1,
      sort: 20,
      specs: [{ id: 'std', name: '250g', price: 14, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '芒瓜双拼',
      desc: '西瓜约500g+芒果约250g，圆顶大杯约750g',
      cover: img('fruit-mango-melon.png'),
      category: '果切系列',
      status: 1,
      sort: 30,
      specs: [{ id: 'std', name: '750g', price: 19, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '阳光青提',
      desc: '脆甜青提约250g，清口不腻',
      cover: img('fruit-green-grape.png'),
      category: '果切系列',
      status: 1,
      sort: 40,
      specs: [{ id: 'std', name: '250g', price: 14, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '蜜瓜清甜',
      desc: '哈密瓜约300g，软糯香甜',
      cover: img('fruit-cantaloupe.png'),
      category: '果切系列',
      status: 1,
      sort: 50,
      specs: [{ id: 'std', name: '300g', price: 13, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '金钻凤梨',
      desc: '去芯凤梨约250g，酸甜开胃',
      cover: img('fruit-pineapple.png'),
      category: '果切系列',
      status: 1,
      sort: 60,
      specs: [{ id: 'std', name: '250g', price: 13, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '火龙鲜切',
      desc: '红心火龙果约250g',
      cover: img('fruit-dragon.png'),
      category: '果切系列',
      status: 1,
      sort: 70,
      specs: [{ id: 'std', name: '250g', price: 13, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '元气三拼',
      desc: '芒果+火龙果+哈密瓜，格子盒分格约300g',
      cover: img('fruit-yuanqi-trip.png'),
      category: '果切系列',
      status: 1,
      sort: 80,
      specs: [{ id: 'std', name: '300g', price: 16, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '热带风情',
      desc: '芒果+橙子+青提，格子盒分格约300g',
      cover: img('fruit-tropical.png'),
      category: '果切系列',
      status: 1,
      sort: 90,
      specs: [{ id: 'std', name: '300g', price: 16, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '红粉佳人',
      desc: '火龙果+草莓+猕猴桃，格子盒分格约300g',
      cover: img('fruit-pink-lady.png'),
      category: '果切系列',
      status: 1,
      sort: 100,
      specs: [{ id: 'std', name: '300g', price: 16, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '奇异果绿',
      desc: '猕猴桃约200g，VC补充',
      cover: img('fruit-kiwi.png'),
      category: '果切系列',
      status: 1,
      sort: 110,
      specs: [{ id: 'std', name: '200g', price: 12, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '缤纷四拼',
      desc: '四种时令水果，四方格子盒分格装约400g',
      cover: img('fruit-colorful-four.png'),
      category: '果切系列',
      status: 1,
      sort: 120,
      specs: [{ id: 'std', name: '400g', price: 18, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '草莓限定',
      desc: '应季草莓约200g，有货才开售',
      cover: img('fruit-strawberry.png'),
      category: '果切系列',
      status: 1,
      sort: 130,
      specs: [{ id: 'std', name: '200g', price: 19, stock: 999 }],
      extras: [],
      createdAt: now,
    },

    // —— 二、水果捞（客单价 ¥22–28） ——
    ...fruitMixProducts(now, uid, img),

    // —— 三、热饮 · 热果奶（后期再开，可先下架） ——
    {
      id: uid(),
      name: '香蕉热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 香甜软糯，30秒出杯',
      cover: img('drink-banana-milk.png'),
      category: '热果奶',
      status: 0,
      sort: 310,
      specs: [{ id: 'std', name: '约300ml', price: 12, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '木瓜热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 果香四溢，暖心暖胃',
      cover: img('drink-papaya-milk.png'),
      category: '热果奶',
      status: 0,
      sort: 320,
      specs: [{ id: 'std', name: '约300ml', price: 14, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: uid(),
      name: '草莓热牛奶',
      desc: '鲜果+热牛奶打匀，约300ml · 冬日限定，少女心满满',
      cover: img('drink-strawberry-milk.png'),
      category: '热果奶',
      status: 0,
      sort: 330,
      specs: [{ id: 'std', name: '约300ml', price: 14, stock: 999 }],
      extras: [],
      createdAt: now,
    },

    // —— 四、经典热饮（后期再开，可先下架） ——
    {
      id: uid(),
      name: '暖心热牛奶',
      desc: '浓郁香滑，暖胃暖心',
      cover: img('drink-hot-milk.png'),
      category: '经典热饮',
      status: 0,
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
      status: 0,
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
      status: 0,
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
      status: 0,
      sort: 440,
      specs: [{ id: 'std', name: '1杯', price: 12, stock: 999 }],
      extras: [],
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
    const db = await mysql.loadMysql();
    if (!Array.isArray(db.coupons)) db.coupons = [];
    return db;
  }
  ensureJson();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(db.coupons)) db.coupons = [];
  return db;
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

module.exports = {
  load,
  save,
  ensure,
  seedProducts,
  fruitMixProducts,
  DATA_DIR,
  DB_FILE,
  DRIVER,
  DIY_EXTRAS,
};
