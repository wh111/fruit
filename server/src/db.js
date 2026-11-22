const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { defaultToppings } = require('./services/toppings');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DRIVER = (process.env.DB_DRIVER || 'json').toLowerCase();

const defaultDb = () => ({
  products: [],
  orders: [],
  users: [],
  coupons: [],
  lottery: null,
  lotteryDraws: [],
  recharges: [],
  walletLedger: [],
  walletBalances: {},
  purchases: [],
  settings: {
    shopName: '四季果先（徐先生）',
    shopPhone: '15701511086',
    // shopContact 仅内部备注，勿下发给用户端
    shopContact: '',
    pickupHint: '取餐前最多40分钟现切，做好后请到柜台报取餐号，店员对一下即可',
    tagline: '现切现做 · 新鲜40分钟',
    groupBuyHint: '企业团购、部门下午茶、会议用果，电话沟通即可。10 份起订。',
  },
  seq: { orderDay: '', pickupNo: 0 },
});

/** 水果捞自选水果（不含草莓、车厘子；小料仍走 db.toppings） */
const DIY_FRUIT_EXTRAS = [
  { id: 'hami', name: '哈密瓜', price: 0 },
  { id: 'honeydew', name: '甜瓜', price: 0 },
  { id: 'dragon', name: '红心火龙果', price: 0 },
  { id: 'banana', name: '香蕉', price: 0 },
  { id: 'mango', name: '芒果', price: 0 },
  { id: 'pineapple', name: '凤梨', price: 0 },
  { id: 'shine', name: '阳光玫瑰', price: 0 },
];
const DIY_EXTRAS = DIY_FRUIT_EXTRAS;

/** 水果超级碗（少糖正餐碗，客单价 ¥30–38） */
function fruitSuperBowlProducts(now, uid, img) {
  return [
    {
      id: 'superbowl-light',
      name: '轻盈超级碗',
      desc: '猕猴桃+草莓+青苹果 · 无糖酸奶底 · 少甜清口，可加鸡胸',
      cover: img('bowl-light-meal.png'),
      category: '水果超级碗',
      status: 1,
      sort: 150,
      specs: [{ id: 'std', name: '大碗', price: 25, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: 'superbowl-sunny',
      name: '阳光超级碗',
      desc: '芒果少量+西柚+青苹果 · 无糖酸奶 · 有甜有酸不齁',
      cover: img('bowl-office-snack.png'),
      category: '水果超级碗',
      status: 1,
      sort: 160,
      specs: [{ id: 'std', name: '大碗', price: 25, stock: 999 }],
      extras: [],
      createdAt: now,
    },
    {
      id: 'superbowl-protein',
      name: '高蛋白超级碗',
      desc: '草莓+猕猴桃+苹果 · 无糖酸奶+现炸鸡胸丝 · 一份顶一顿',
      cover: img('bowl-protein-energy.png'),
      category: '水果超级碗',
      status: 1,
      sort: 170,
      specs: [{ id: 'std', name: '大碗含鸡胸', price: 32, stock: 999 }],
      extras: [],
      createdAt: now,
    },
  ];
}

/** 果切 / 网红小吃 / 新鲜现剥（规格名沿用 250g/400g，只改价格） */
function fruitCutMenuProducts(now, img) {
  const two = (a, b) => [
    { id: 's250', name: '250g', price: a, stock: 999 },
    { id: 's400', name: '400g', price: b, stock: 999 },
  ];
  const base = (p) => ({
    status: 1,
    extras: [],
    createdAt: now,
    ...p,
  });

  return [
    // —— 网红小吃 ——
    base({
      id: 'cut-single-plum-tomato',
      name: '乌梅小番茄（250g/400g）',
      desc: '乌梅小番茄 · 可选 250g / 400g',
      cover: img('cut-plum-tomato.jpg'),
      category: '网红小吃',
      sort: 10,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'cut-single-plum-pineapple',
      name: '乌梅凤梨（250g/400g）',
      desc: '乌梅凤梨 · 可选 250g / 400g',
      cover: img('cut-plum-pineapple.jpg'),
      category: '网红小吃',
      sort: 20,
      specs: two(16.8, 18.8),
    }),
    base({
      id: 'cut-duo-plum-tomato-pineapple',
      name: '乌梅小番茄＋乌梅凤梨（250g/400g）',
      desc: '乌梅小番茄＋乌梅凤梨 · 可选 250g / 400g',
      cover: img('cut-duo-plum-tomato-pineapple.jpg'),
      category: '网红小吃',
      sort: 30,
      specs: two(13.8, 15.8),
    }),
    base({
      id: 'cut-plum-shine',
      name: '乌梅阳光玫瑰（250g/400g）',
      desc: '乌梅阳光玫瑰 · 可选 250g / 400g',
      cover: img('cut-shine-grape.jpg'),
      category: '网红小吃',
      sort: 40,
      specs: two(11.8, 13.8),
    }),
    base({
      id: 'cut-plum-strawberry',
      name: '乌梅草莓（250g/400g）',
      desc: '乌梅草莓 · 可选 250g / 400g',
      cover: img('cut-plum-strawberry.jpg'),
      category: '网红小吃',
      sort: 50,
      specs: two(18.8, 21.8),
    }),
    base({
      id: 'cut-duo-plum-strawberry-pineapple',
      name: '乌梅草莓＋乌梅凤梨（250g/400g）',
      desc: '乌梅草莓＋乌梅凤梨 · 可选 250g / 400g',
      cover: img('cut-duo-plum-strawberry-pineapple.jpg'),
      category: '网红小吃',
      sort: 60,
      specs: two(21.8, 24.8),
    }),
    // —— 新鲜现剥 ——
    base({
      id: 'cut-single-red-pomelo',
      name: '现剥红心蜜柚肉（250g/400g）',
      desc: '现剥红心蜜柚肉 · 可选 250g / 400g',
      cover: img('cut-red-pomelo.jpg'),
      category: '新鲜现剥',
      sort: 10,
      specs: two(9.9, 12.8),
    }),
    base({
      id: 'cut-jackfruit',
      name: '现剥菠萝蜜肉（250g/400g）',
      desc: '现剥菠萝蜜肉 · 可选 250g / 400g',
      cover: img('cut-jackfruit.jpg'),
      category: '新鲜现剥',
      sort: 20,
      specs: two(12.8, 15.8),
    }),
    base({
      id: 'cut-duo-jackfruit-pomelo',
      name: '菠萝蜜肉＋红柚肉（250g/400g）',
      desc: '菠萝蜜肉＋红柚肉 · 可选 250g / 400g',
      cover: img('cut-jackfruit-pomelo.jpg'),
      category: '新鲜现剥',
      sort: 30,
      specs: two(11.8, 14.8),
    }),
    base({
      id: 'cut-sugarcane',
      name: '去皮去节甘蔗肉（250g/500g）',
      desc: '去皮去节甘蔗肉 · 可选 250g / 500g',
      cover: img('cut-sugarcane-ref.jpg'),
      category: '新鲜现剥',
      sort: 40,
      specs: [
        { id: 's250', name: '250g', price: 11.8, stock: 999 },
        { id: 's500', name: '500g', price: 21.8, stock: 999 },
      ],
    }),
    // —— 果切单拼 ——
    base({
      id: 'cut-single-watermelon',
      name: '西瓜（250g/400g）',
      desc: '单拼现切西瓜 · 可选 250g / 400g',
      cover: img('cut-watermelon.png'),
      category: '果切系列',
      sort: 10,
      specs: two(11.8, 13.8),
    }),
    base({
      id: 'cut-single-honeydew',
      name: '甜瓜（250g/400g）',
      desc: '单拼现切甜瓜 · 可选 250g / 400g',
      cover: img('cut-honeydew.png'),
      category: '果切系列',
      sort: 20,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'cut-single-hami',
      name: '哈密瓜（250g/400g）',
      desc: '单拼现切哈密瓜 · 可选 250g / 400g',
      cover: img('cut-hami.png'),
      category: '果切系列',
      sort: 30,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'cut-single-pineapple',
      name: '凤梨（250g/400g）',
      desc: '单拼现切凤梨 · 可选 250g / 400g',
      cover: img('cut-pineapple.png'),
      category: '果切系列',
      sort: 40,
      specs: two(13.8, 16.8),
    }),
    base({
      id: 'cut-single-papaya',
      name: '木瓜（250g/400g）',
      desc: '单拼现切木瓜 · 可选 250g / 400g',
      cover: img('cut-papaya.png'),
      category: '果切系列',
      sort: 50,
      specs: two(10.8, 12.8),
    }),
    base({
      id: 'cut-single-mango',
      name: '芒果（250g/400g）',
      desc: '单拼现切芒果 · 可选 250g / 400g',
      cover: img('cut-mango.png'),
      category: '果切系列',
      sort: 60,
      specs: two(12.8, 14.8),
    }),
    base({
      id: 'cut-single-dragon',
      name: '火龙果（250g/400g）',
      desc: '单拼现切火龙果 · 可选 250g / 400g',
      cover: img('cut-dragon.png'),
      category: '果切系列',
      sort: 70,
      specs: two(10.8, 11.8),
    }),
    base({
      id: 'cut-single-orange',
      name: '橙子（250g/400g）',
      desc: '单拼现切橙子 · 可选 250g / 400g',
      cover: img('cut-orange.jpg'),
      category: '果切系列',
      sort: 80,
      specs: two(12.8, 15.8),
    }),
    base({
      id: 'cut-single-kiwi',
      name: '猕猴桃（250g/400g）',
      desc: '单拼现切猕猴桃 · 可选 250g / 400g',
      cover: img('cut-kiwi.jpg'),
      category: '果切系列',
      sort: 90,
      specs: two(11.8, 13.8),
    }),
    // —— 双拼 ——
    base({
      id: 'cut-duo-watermelon-honeydew',
      name: '西瓜＋甜瓜（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-watermelon-honeydew.png'),
      category: '果切系列',
      sort: 110,
      specs: two(12.8, 14.8),
    }),
    base({
      id: 'cut-duo-watermelon-hami',
      name: '西瓜＋哈密瓜（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-watermelon-hami.png'),
      category: '果切系列',
      sort: 120,
      specs: two(12.8, 14.8),
    }),
    base({
      id: 'cut-duo-hami-honeydew',
      name: '哈密瓜＋甜瓜（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-hami-honeydew.png'),
      category: '果切系列',
      sort: 130,
      specs: two(10.8, 11.8),
    }),
    base({
      id: 'cut-duo-orange-kiwi',
      name: '甜橙＋猕猴桃（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-orange-kiwi.png'),
      category: '果切系列',
      sort: 140,
      specs: two(13.8, 16.8),
    }),
    base({
      id: 'cut-duo-dragon-mango',
      name: '火龙果＋芒果（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-dragon-mango.png'),
      category: '果切系列',
      sort: 150,
      specs: two(12.8, 15.8),
    }),
    base({
      id: 'cut-duo-pineapple-watermelon',
      name: '凤梨＋西瓜（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-duo-pineapple-watermelon.png'),
      category: '果切系列',
      sort: 160,
      specs: two(13.8, 15.8),
    }),
    base({
      id: 'cut-duo-watermelon-dragon',
      name: '西瓜＋火龙果（250g/400g）',
      desc: '双拼现切 · 可选 250g / 400g',
      cover: img('cut-watermelon-dragon.jpg'),
      category: '果切系列',
      sort: 170,
      specs: two(12.8, 14.8),
    }),
    // —— 三拼 ——
    base({
      id: 'cut-tri-watermelon-hami-honeydew',
      name: '西瓜＋哈密瓜＋甜瓜（250g/400g）',
      desc: '三拼现切 · 可选 250g / 400g',
      cover: img('cut-tri-watermelon-hami-honeydew.png'),
      category: '果切系列',
      sort: 210,
      specs: two(13.8, 15.8),
    }),
    base({
      id: 'cut-tri-mango-dragon-pineapple',
      name: '芒果＋火龙果＋凤梨（250g/400g）',
      desc: '三拼现切 · 可选 250g / 400g',
      cover: img('cut-tri-mango-dragon-pineapple.png'),
      category: '果切系列',
      sort: 220,
      specs: two(16.8, 18.8),
    }),
    base({
      id: 'cut-tri-orange-kiwi-dragon',
      name: '甜橙＋猕猴桃＋火龙果（250g/400g）',
      desc: '三拼现切 · 可选 250g / 400g',
      cover: img('cut-tri-orange-kiwi-dragon.png'),
      category: '果切系列',
      sort: 230,
      specs: two(12.8, 14.8),
    }),
    base({
      id: 'cut-tri-pineapple-hami-honeydew',
      name: '凤梨＋哈密瓜＋甜瓜（250g/400g）',
      desc: '三拼现切 · 可选 250g / 400g',
      cover: img('cut-tri-pineapple-hami-honeydew.png'),
      category: '果切系列',
      sort: 240,
      specs: two(13.8, 16.8),
    }),
    base({
      id: 'cut-tri-watermelon-mango-dragon',
      name: '西瓜＋芒果＋火龙果（250g/400g）',
      desc: '三拼现切 · 可选 250g / 400g',
      cover: img('cut-watermelon-mango-dragon.jpg'),
      category: '果切系列',
      sort: 250,
      specs: two(14.8, 16.8),
    }),
    // —— 豪华果拼 ——
    base({
      id: 'cut-luxury-premium',
      name: '豪华果拼（500g/800g）',
      desc: '草莓＋红提＋阳光玫瑰＋凤梨＋龙眼＋猕猴桃＋火龙果＋橙子＋芒果',
      cover: img('cut-luxury.jpg'),
      category: '果切系列',
      sort: 300,
      specs: [{ id: 'std', name: '标准份', price: 28.8, stock: 999 }],
    }),
  ];
}

/** 酸奶捞：仅上线三拼 / 五拼自选（酸奶底；水果现场自选） */
function fruitMixProducts(now, _uid, img) {
  const fruits = DIY_FRUIT_EXTRAS.map((e) => ({ ...e }));
  return [
    {
      id: 'mix-diy-3',
      name: '三拼自选水果捞（300g/450g）',
      desc: '酸奶底 · 自选 3 种水果',
      cover: img('mix-yogurt-fruit.png'),
      category: '酸奶捞',
      status: 1,
      sort: 10,
      extraPick: 3,
      specs: [
        { id: 's300', name: '300g', price: 9.9, stock: 999 },
        { id: 's450', name: '450g', price: 12.8, stock: 999 },
      ],
      extras: fruits,
      createdAt: now,
    },
    {
      id: 'mix-diy-5',
      name: '五拼自选水果捞（300g/450g）',
      desc: '酸奶底 · 自选 5 种水果',
      cover: img('mix-diy-5-like3.jpg'),
      category: '酸奶捞',
      status: 1,
      sort: 20,
      extraPick: 5,
      specs: [
        { id: 's300', name: '300g', price: 12.8, stock: 999 },
        { id: 's450', name: '450g', price: 15.8, stock: 999 },
      ],
      extras: fruits,
      createdAt: now,
    },
  ];
}

/** 鲜榨果汁（规格 300ml / 500ml） */
function freshJuiceProducts(now, img) {
  const two = (a, b) => [
    { id: 's300', name: '300ml', price: a, stock: 999 },
    { id: 's500', name: '500ml', price: b, stock: 999 },
  ];
  const base = (p) => ({
    status: 1,
    extras: [],
    createdAt: now,
    ...p,
  });
  const juiceDesc = '鲜榨现打 · 可选 300ml / 500ml';
  const oxiDesc = '鲜榨现打 · 易氧化，建议尽快饮用 · 可选 300ml / 500ml';
  const milkDesc = '鲜果打牛奶 · 可选 300ml / 500ml';

  return [
    base({
      id: 'juice-honeydew',
      name: '玉菇甜瓜汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-honeydew.jpg'),
      category: '鲜榨果汁',
      sort: 10,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'juice-pear',
      name: '梨汁（易氧化）（300ml/500ml）',
      desc: oxiDesc,
      cover: img('drink-apple-orange.png'),
      category: '鲜榨果汁',
      sort: 20,
      specs: two(10.8, 12.8),
    }),
    base({
      id: 'juice-orange',
      name: '鲜橙汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-orange.jpg'),
      category: '鲜榨果汁',
      sort: 30,
      specs: two(16.8, 18.8),
    }),
    base({
      id: 'juice-apple',
      name: '苹果汁（易氧化）（300ml/500ml）',
      desc: oxiDesc,
      cover: img('drink-apple-orange.png'),
      category: '鲜榨果汁',
      sort: 40,
      specs: two(11.8, 12.8),
    }),
    base({
      id: 'juice-kiwi-pear',
      name: '猕猴桃雪梨汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-kiwi-pear.jpg'),
      category: '鲜榨果汁',
      sort: 50,
      specs: two(18.8, 21.8),
    }),
    base({
      id: 'juice-grape',
      name: '提子汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-red-grape.jpg'),
      category: '鲜榨果汁',
      sort: 60,
      specs: two(17.8, 19.8),
    }),
    base({
      id: 'juice-watermelon',
      name: '西瓜汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-watermelon.jpg'),
      category: '鲜榨果汁',
      sort: 70,
      specs: two(12.8, 14.8),
    }),
    base({
      id: 'juice-hami',
      name: '哈密瓜汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-hami.jpg'),
      category: '鲜榨果汁',
      sort: 80,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'juice-banana-milk',
      name: '香蕉牛奶（300ml/500ml）',
      desc: milkDesc,
      cover: img('drink-banana-milk.png'),
      category: '鲜榨果汁',
      sort: 90,
      specs: two(9.9, 11.8),
    }),
    base({
      id: 'juice-mango-milk',
      name: '芒果牛奶（300ml/500ml）',
      desc: milkDesc,
      cover: img('drink-mango-milk.jpg'),
      category: '鲜榨果汁',
      sort: 100,
      specs: two(11.8, 12.8),
    }),
    base({
      id: 'juice-strawberry-milk',
      name: '草莓牛奶（300ml/500ml）',
      desc: milkDesc,
      cover: img('drink-strawberry-milk.png'),
      category: '鲜榨果汁',
      sort: 110,
      specs: two(13.8, 15.8),
    }),
    base({
      id: 'juice-dragon-pear',
      name: '火龙果雪梨汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-dragon-pear.jpg'),
      category: '鲜榨果汁',
      sort: 120,
      specs: two(11.8, 13.8),
    }),
    base({
      id: 'juice-strawberry-pear',
      name: '草莓雪梨汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-strawberry-milk.png'),
      category: '鲜榨果汁',
      sort: 130,
      specs: two(11.8, 13.8),
    }),
    base({
      id: 'juice-tomato-pear',
      name: '番茄雪梨汁（300ml/500ml）',
      desc: juiceDesc,
      cover: img('drink-tomato-pear.jpg'),
      category: '鲜榨果汁',
      sort: 140,
      specs: two(10.8, 12.8),
    }),
  ];
}

/** 店内 EAN-13：21 + 04901 + 5 位货号 + 校验位 */
function shopEan13(itemNo) {
  const n = String(Math.max(1, Number(itemNo) || 1)).padStart(5, '0').slice(-5);
  const body = `2104901${n}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + String((10 - (sum % 10)) % 10);
}

/** 水果零售 · 免洗小盒什锦（单档标价） */
function retailMixProducts(now, img) {
  const box = (price, itemNo) => [
    { id: 'std', name: '350g', price, stock: 999, barcode: shopEan13(itemNo) },
  ];
  const base = (p) => ({
    status: 1,
    extras: [],
    createdAt: now,
    ...p,
  });
  const desc = '免洗什锦 350g · 开袋即食';
  return [
    base({
      id: 'retail-mix-jujube-tomato-kumquat',
      name: '冬枣＋小番茄＋金桔',
      desc,
      cover: img('retail-shine-jujube.jpg'),
      category: '免洗什锦',
      sort: 10,
      specs: box(6.8, 1),
    }),
    base({
      id: 'retail-mix-tangerine-kiwi-longan',
      name: '沙糖桔＋猕猴桃＋龙眼（350g）',
      desc,
      cover: img('retail-box-mandarin-kiwi-longan.jpg'),
      category: '免洗什锦',
      sort: 20,
      specs: box(8.8, 2),
    }),
    base({
      id: 'retail-mix-grape-shine-jackfruit',
      name: '提子＋阳光玫瑰＋菠萝蜜',
      desc,
      cover: img('retail-blueberry-tomato-shine.jpg'),
      category: '免洗什锦',
      sort: 30,
      specs: box(9.8, 3),
    }),
    base({
      id: 'retail-mix-milk-jujube-tomato-kumquat',
      name: '牛奶枣＋小番茄＋金桔',
      desc,
      cover: img('retail-shine-jujube.jpg'),
      category: '免洗什锦',
      sort: 40,
      specs: box(7.8, 4),
    }),
  ];
}

function seedProducts(db) {
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const img = (name) => `/assets/products/menu/${name}`;

  db.products = [
    // —— 一、果切系列（单拼 / 双拼 / 三拼） ——
    ...fruitCutMenuProducts(now, img),
    // —— 水果零售（免洗小盒什锦，可走抽奖免单） ——
    ...retailMixProducts(now, img),

    // —— 二、水果捞（客单价 ¥22–28） ——
    ...fruitMixProducts(now, uid, img),

    // —— 鲜榨果汁（300ml / 500ml） ——
    ...freshJuiceProducts(now, img),

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

    // —— 五、经典热饮（后期再开，可先下架） ——
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

/** 门店新鲜度文案统一为「40分钟」（覆盖半小时 / 一小时等旧口径） */
function ensureShopFreshCopy(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const s = db.settings;
  let changed = false;
  const defaults = defaultDb().settings;
  const normalize = (text) =>
    String(text || '')
      .replace(/半小时/g, '40分钟')
      .replace(/一小时/g, '40分钟')
      .replace(/1\s*小时/g, '40分钟');
  const patch = (key, fallback) => {
    const cur = String(s[key] || '');
    if (!cur) {
      s[key] = fallback;
      changed = true;
      return;
    }
    const next = normalize(cur);
    if (next !== cur) {
      s[key] = next;
      changed = true;
    }
  };
  patch('pickupHint', defaults.pickupHint);
  patch('tagline', defaults.tagline);
  return changed;
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
    if (!Array.isArray(db.lotteryDraws)) db.lotteryDraws = [];
    if (!Array.isArray(db.purchases)) db.purchases = [];
    const copyChanged = ensureShopFreshCopy(db);
    await ensureToppings(db);
    await ensureRetireLegacyBowls(db);
    await ensureFruitCutMenu(db);
    await ensureDiyFruitMixMenu(db);
    await ensureFreshJuiceMenu(db);
    await ensureRetailMixMenu(db);
    try {
      const { ensureSideMeal } = require('./services/sideMeals');
      ensureSideMeal(db);
    } catch {
      /* ignore */
    }
    try {
      const { ensureWallet, hydrateBalances } = require('./services/wallet');
      ensureWallet(db);
      hydrateBalances(db);
    } catch {
      /* ignore */
    }
    if (copyChanged) await save(db);
    return db;
  }
  ensureJson();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(db.coupons)) db.coupons = [];
  if (!Array.isArray(db.lotteryDraws)) db.lotteryDraws = [];
  if (!Array.isArray(db.recharges)) db.recharges = [];
  if (!Array.isArray(db.walletLedger)) db.walletLedger = [];
  if (!Array.isArray(db.purchases)) db.purchases = [];
  if (!db.walletBalances || typeof db.walletBalances !== 'object') db.walletBalances = {};
  const copyChanged = ensureShopFreshCopy(db);
  await ensureToppings(db);
  await ensureRetireLegacyBowls(db);
  await ensureFruitCutMenu(db);
  await ensureDiyFruitMixMenu(db);
  await ensureFreshJuiceMenu(db);
  await ensureRetailMixMenu(db);
  try {
    const { ensureSideMeal } = require('./services/sideMeals');
    ensureSideMeal(db);
  } catch {
    /* ignore */
  }
  try {
    const { ensureWallet, hydrateBalances } = require('./services/wallet');
    ensureWallet(db);
    hydrateBalances(db);
  } catch {
    /* ignore */
  }
  if (copyChanged) await save(db);
  return db;
}

/**
 * 小料：仅在「从未初始化」时播种默认列表。
 * 空数组 = 后台已清空，禁止每次 load 把默认小料补回来。
 */
async function ensureToppings(db) {
  if (!Array.isArray(db.toppings)) {
    db.toppings = defaultToppings();
    await save(db);
  }
}

/** 下架已停售品类：冷食代餐碗 / 水果超级碗 / 酸奶杯（保留订单历史） */
const RETIRED_CATEGORIES = new Set(['冷食代餐碗', '水果超级碗', '酸奶杯']);
const RETIRED_NAME_RE = /冷食代餐|超级碗|酸奶杯/;

async function ensureRetireLegacyBowls(db) {
  if (!Array.isArray(db.products)) return;
  let changed = false;
  for (const cur of db.products) {
    if (!cur) continue;
    const byCat = RETIRED_CATEGORIES.has(cur.category);
    const byName = RETIRED_NAME_RE.test(String(cur.name || ''));
    if (!byCat && !byName) continue;
    if (cur.status !== 0) {
      cur.status = 0;
      changed = true;
    }
  }
  // 稳定 id 超级碗也强制下架
  for (const id of ['superbowl-light', 'superbowl-sunny', 'superbowl-protein']) {
    const cur = db.products.find((x) => x && x.id === id);
    if (cur && cur.status !== 0) {
      cur.status = 0;
      changed = true;
    }
  }
  if (changed) await save(db);
}

/** @deprecated 保留导出兼容；已改为下架而非补齐 */
async function ensureSuperBowlProducts(db) {
  return ensureRetireLegacyBowls(db);
}

/**
 * 规格克重口径：
 * - 果切：350/500 → 250/400（价格保留；双拼/三拼若仅一档则补齐两档）
 * - 水果捞：中份/大份 → 300g/450g
 */
function migrateProductSpecWeights(db) {
  if (!Array.isArray(db.products)) return false;
  let changed = false;

  const renameSpec = (spec, fromNames, fromIds, toId, toName) => {
    const name = String(spec.name || '');
    const id = String(spec.id || '');
    if (fromNames.includes(name) || fromIds.includes(id)) {
      if (spec.id !== toId || spec.name !== toName) {
        spec.id = toId;
        spec.name = toName;
        return true;
      }
    }
    return false;
  };

  for (const cur of db.products) {
    if (!cur || !Array.isArray(cur.specs) || !cur.specs.length) continue;

    if (cur.category === '果切系列' || String(cur.id || '').startsWith('cut-')) {
      // 甘蔗大份是 500g，不要被果切的 500→400 口径改掉
      if (cur.id === 'cut-sugarcane') continue;
      for (const s of cur.specs) {
        if (renameSpec(s, ['350g'], ['s350'], 's250', '250g')) changed = true;
        else if (renameSpec(s, ['500g'], ['s500'], 's400', '400g')) changed = true;
        else if (s.id === 'std' && String(s.name || '') === '500g') {
          s.id = 's400';
          s.name = '400g';
          changed = true;
        }
      }
      // 仅一档时补齐小份，价格按大份下浮 2 元（不低于 1）
      const has250 = cur.specs.some((s) => s.name === '250g' || s.id === 's250');
      const has400 = cur.specs.some((s) => s.name === '400g' || s.id === 's400');
      if (has400 && !has250) {
        const big = cur.specs.find((s) => s.name === '400g' || s.id === 's400');
        const price = Math.max(1, Number(big.price || 0) - 2);
        cur.specs.unshift({
          id: 's250',
          name: '250g',
          price,
          stock: Number(big.stock) > 0 ? big.stock : 999,
        });
        changed = true;
      }
      if (typeof cur.desc === 'string' && (cur.desc.includes('350g') || cur.desc.includes('500g'))) {
        cur.desc = cur.desc
          .replace(/350g/g, '250g')
          .replace(/500g/g, '400g')
          .replace(/约 400g/g, '可选 250g / 400g');
        changed = true;
      }
      continue;
    }

    if (cur.category === '水果捞' || cur.category === '酸奶捞') {
      for (const s of cur.specs) {
        if (renameSpec(s, ['中份', '小份'], ['std', 's300'], 's300', '300g')) changed = true;
        else if (renameSpec(s, ['大份'], ['lg', 's450'], 's450', '450g')) changed = true;
      }
      const has300 = cur.specs.some((s) => s.name === '300g' || s.id === 's300');
      const has450 = cur.specs.some((s) => s.name === '450g' || s.id === 's450');
      if (has300 && !has450) {
        const small = cur.specs.find((s) => s.name === '300g' || s.id === 's300');
        const price = Number(small.price || 0) + 4;
        cur.specs.push({
          id: 's450',
          name: '450g',
          price: Math.max(price, Number(small.price || 0) + 1),
          stock: Number(small.stock) > 0 ? small.stock : 999,
        });
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * 门店果切菜单：只补齐「库里从未出现过」的稳定 SKU；不下架后再偷偷上架。
 * 后台删除是 status=0（软删），不会被本函数复活。
 * 已存在商品的价格/规格/排序/上下架以管理端为准，禁止每次 load 覆盖。
 */
async function ensureFruitCutMenu(db) {
  if (!Array.isArray(db.products)) db.products = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  // 记录曾出现过的果切 id，避免硬删后被默认菜单反复塞回
  if (!Array.isArray(db.settings.knownCutProductIds)) {
    db.settings.knownCutProductIds = db.products
      .filter((p) => p && String(p.id || '').startsWith('cut-'))
      .map((p) => p.id);
  }
  const knownCuts = new Set(db.settings.knownCutProductIds);
  const now = Date.now();
  const img = (name) => `/assets/products/menu/${name}`;
  const wanted = fruitCutMenuProducts(now, img);
  const wantedIds = new Set(wanted.map((p) => p.id));
  let changed = migrateProductSpecWeights(db);

  for (const p of wanted) {
    const idx = db.products.findIndex((x) => x && x.id === p.id);
    if (idx < 0) {
      // 只在首次见到该稳定 id 时补齐；曾经存在过（含已硬删）则不再自动加回
      if (knownCuts.has(p.id)) continue;
      db.products.push({ ...p });
      knownCuts.add(p.id);
      changed = true;
      continue;
    }
    if (!knownCuts.has(p.id)) {
      knownCuts.add(p.id);
      changed = true;
    }
    const cur = db.products[idx];
    // 仅补分类/封面等非价格字段的空缺，不改 specs.price / status / sort
    if (!cur.category) {
      cur.category = '果切系列';
      changed = true;
    }
    if (!cur.cover && p.cover) {
      cur.cover = p.cover;
      changed = true;
    }
    if (!Array.isArray(cur.specs) || !cur.specs.length) {
      cur.specs = p.specs.map((s) => ({ ...s }));
      changed = true;
    }
    if (!Array.isArray(cur.extras)) {
      cur.extras = [];
      changed = true;
    }
  }

  // 旧果切（非 cut-* 稳定 id）下架，保留订单历史
  for (const cur of db.products) {
    if (!cur || cur.category !== '果切系列') continue;
    if (wantedIds.has(cur.id)) continue;
    if (cur.status !== 0) {
      cur.status = 0;
      changed = true;
    }
  }

  const nextKnown = [...knownCuts];
  const prevKnown = db.settings.knownCutProductIds || [];
  if (
    nextKnown.length !== prevKnown.length ||
    nextKnown.some((id, i) => id !== prevKnown[i])
  ) {
    db.settings.knownCutProductIds = nextKnown;
    changed = true;
  }

  if (changed) await save(db);
}

/**
 * 水果捞只保留三拼/五拼自选；旧款水果捞、热果奶、经典热饮全部下架。
 * 自选 SKU 每次对齐 extras / extraPick / 文案（价格若已人工改过则保留）。
 */
async function ensureDiyFruitMixMenu(db) {
  if (!Array.isArray(db.products)) db.products = [];
  const now = Date.now();
  const img = (name) => `/assets/products/menu/${name}`;
  const wanted = fruitMixProducts(now, null, img);
  const wantedIds = new Set(wanted.map((p) => p.id));
  let changed = false;

  for (const p of wanted) {
    const idx = db.products.findIndex((x) => x && x.id === p.id);
    if (idx < 0) {
      db.products.push({ ...p, extras: p.extras.map((e) => ({ ...e })) });
      changed = true;
      continue;
    }
    const cur = db.products[idx];
    // 不覆盖 status：后台下架后须保持下架，避免重启又强制上架
    const patch = {
      name: p.name,
      desc: p.desc,
      category: '酸奶捞',
      sort: p.sort,
      extraPick: p.extraPick,
      cover: cur.cover || p.cover,
      extras: DIY_FRUIT_EXTRAS.map((e) => ({ ...e })),
    };
    if (!Array.isArray(cur.specs) || !cur.specs.length) {
      patch.specs = p.specs.map((s) => ({ ...s }));
    }
    let dirty = false;
    for (const [k, v] of Object.entries(patch)) {
      const same =
        k === 'extras'
          ? JSON.stringify(cur.extras || []) === JSON.stringify(v)
          : cur[k] === v;
      if (!same) {
        cur[k] = v;
        dirty = true;
      }
    }
    if (dirty) {
      cur.updatedAt = now;
      changed = true;
    }
  }

  for (const cur of db.products) {
    if (!cur) continue;
    const cat = String(cur.category || '');
    if ((cat === '水果捞' || cat === '酸奶捞') && !wantedIds.has(cur.id) && cur.status !== 0) {
      cur.status = 0;
      cur.updatedAt = now;
      changed = true;
    }
    if ((cat === '热果奶' || cat === '经典热饮') && cur.status !== 0) {
      cur.status = 0;
      cur.updatedAt = now;
      changed = true;
    }
  }

  if (changed) await save(db);
}

/**
 * 鲜榨果汁：只补齐从未出现过的稳定 SKU；已存在的价格/上下架以管理端为准。
 */
async function ensureFreshJuiceMenu(db) {
  if (!Array.isArray(db.products)) db.products = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!Array.isArray(db.settings.knownJuiceProductIds)) {
    db.settings.knownJuiceProductIds = db.products
      .filter((p) => p && String(p.id || '').startsWith('juice-'))
      .map((p) => p.id);
  }
  const known = new Set(db.settings.knownJuiceProductIds);
  const now = Date.now();
  const img = (name) => `/assets/products/menu/${name}`;
  const wanted = freshJuiceProducts(now, img);
  let changed = false;

  for (const p of wanted) {
    const idx = db.products.findIndex((x) => x && x.id === p.id);
    if (idx < 0) {
      if (known.has(p.id)) continue;
      db.products.push({ ...p });
      known.add(p.id);
      changed = true;
      continue;
    }
    if (!known.has(p.id)) {
      known.add(p.id);
      changed = true;
    }
    const cur = db.products[idx];
    if (!cur.category) {
      cur.category = '鲜榨果汁';
      changed = true;
    }
    if (!cur.cover && p.cover) {
      cur.cover = p.cover;
      changed = true;
    }
    if (!Array.isArray(cur.specs) || !cur.specs.length) {
      cur.specs = p.specs.map((s) => ({ ...s }));
      changed = true;
    }
    if (!Array.isArray(cur.extras)) {
      cur.extras = [];
      changed = true;
    }
  }

  const nextKnown = [...known];
  const prevKnown = db.settings.knownJuiceProductIds || [];
  if (
    nextKnown.length !== prevKnown.length ||
    nextKnown.some((id, i) => id !== prevKnown[i])
  ) {
    db.settings.knownJuiceProductIds = nextKnown;
    changed = true;
  }

  if (changed) await save(db);
}

/**
 * 水果零售什锦：补齐四款小盒；旧「免洗什锦」等非菜单 SKU 下架。
 */
async function ensureRetailMixMenu(db) {
  if (!Array.isArray(db.products)) db.products = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!Array.isArray(db.settings.knownRetailProductIds)) {
    db.settings.knownRetailProductIds = db.products
      .filter((p) => p && String(p.id || '').startsWith('retail-mix-'))
      .map((p) => p.id);
  }
  const known = new Set(db.settings.knownRetailProductIds);
  const now = Date.now();
  const img = (name) => `/assets/products/menu/${name}`;
  const wanted = retailMixProducts(now, img);
  const wantedIds = new Set(wanted.map((p) => p.id));
  let changed = false;

  for (const p of wanted) {
    const idx = db.products.findIndex((x) => x && x.id === p.id);
    if (idx < 0) {
      if (known.has(p.id)) continue;
      db.products.push({ ...p });
      known.add(p.id);
      changed = true;
      continue;
    }
    if (!known.has(p.id)) {
      known.add(p.id);
      changed = true;
    }
    const cur = db.products[idx];
    if (!cur.category) {
      cur.category = '免洗什锦';
      changed = true;
    }
    if (!cur.cover && p.cover) {
      cur.cover = p.cover;
      changed = true;
    }
    if (!Array.isArray(cur.specs) || !cur.specs.length) {
      cur.specs = p.specs.map((s) => ({ ...s }));
      changed = true;
    } else if (Array.isArray(p.specs)) {
      p.specs.forEach((s, i) => {
        if (!cur.specs[i]) return;
        if (s.barcode && cur.specs[i].barcode !== s.barcode) {
          cur.specs[i].barcode = s.barcode;
          changed = true;
        }
        if (s.name && cur.specs[i].name !== s.name) {
          cur.specs[i].name = s.name;
          changed = true;
        }
      });
    }
    if (!Array.isArray(cur.extras)) {
      cur.extras = [];
      changed = true;
    }
  }

  for (const cur of db.products) {
    if (!cur) continue;
    const cat = String(cur.category || '');
    if ((cat === '免洗什锦' || cat === '水果零售' || cat === '零售什锦') && !wantedIds.has(cur.id) && cur.status !== 0) {
      cur.status = 0;
      cur.updatedAt = now;
      changed = true;
    }
  }

  const nextKnown = [...known];
  const prevKnown = db.settings.knownRetailProductIds || [];
  if (
    nextKnown.length !== prevKnown.length ||
    nextKnown.some((id, i) => id !== prevKnown[i])
  ) {
    db.settings.knownRetailProductIds = nextKnown;
    changed = true;
  }

  if (changed) await save(db);
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
  fruitCutMenuProducts,
  fruitMixProducts,
  freshJuiceProducts,
  retailMixProducts,
  fruitSuperBowlProducts,
  ensureFruitCutMenu,
  ensureDiyFruitMixMenu,
  ensureFreshJuiceMenu,
  ensureRetailMixMenu,
  DATA_DIR,
  DB_FILE,
  DRIVER,
  DIY_EXTRAS,
  DIY_FRUIT_EXTRAS,
};
