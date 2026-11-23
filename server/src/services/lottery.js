/**
 * 开业抽奖
 * - 奖品与活动日期可配置（db.lottery）
 * - 每账号活动期内仅可抽 1 次
 * - 默认 enabled=false，不上线；开业时在管理端打开
 *
 * 默认奖池（权重合计 1000）：
 * 特殊奖200元(20元×10) 0.1%·限2名 / 15元 5% / 8折 60% / 7折 22% / 6折 12.9%
 * 折券：仅原价 ≤30 元订单可用
 * 立减券：现取/预定均可
 */
const crypto = require('crypto');
const { round2, shopParts } = require('./promo');
const { ensureCoupons, VALID_DAYS } = require('./coupon');

const LOTTERY_PACK = 'opening_lottery';

/** 默认权重：特奖 1/1000，其余保持原相对占比 */
const DEFAULT_PRIZE_WEIGHTS = {
  special200: 1,
  flat15: 50,
  off8: 600,
  off7: 220,
  off6: 129,
};

function defaultLottery() {
  return {
    id: 'opening_2026',
    title: '开业抽奖',
    subtitle: '登录抽好礼 · 每人限一次',
    enabled: false,
    /** Asia/Shanghai 日历日 YYYY-MM-DD；空则不限 */
    startDate: '',
    endDate: '',
    validDays: VALID_DAYS,
    rules: [
      '活动期间每个微信账号仅可抽奖 1 次',
      '特殊奖「200元券包」中奖率约千分之一，仅 2 个名额：20元无门槛券×10，抽完即止',
      '8/7/6 折优惠券仅适用于原价 30 元及以下商品',
      '立减券（15元 / 20元）：现取/预定均可，每单限用 1 张',
      '奖品自动发到「我的优惠券」，过期作废',
      '活动奖品与现有新人券可分别使用，每单限用 1 张券',
    ],
    prizes: [
      {
        id: 'special200',
        title: '特奖200元',
        type: 'flat',
        weight: DEFAULT_PRIZE_WEIGHTS.special200,
        amount: 20,
        threshold: 0,
        qty: 10,
        stock: 2,
        desc: '特殊奖 · 千分之一 · 仅2个名额 · 20元无门槛券×10',
      },
      {
        id: 'flat15',
        title: '15元无门槛券',
        type: 'flat',
        weight: DEFAULT_PRIZE_WEIGHTS.flat15,
        amount: 15,
        threshold: 0,
        qty: 1,
        desc: '无门槛立减15元，现取预定均可',
      },
      {
        id: 'off8',
        title: '8折优惠券×2',
        type: 'percent',
        weight: DEFAULT_PRIZE_WEIGHTS.off8,
        discountFactor: 0.8,
        maxOriginal: 30,
        qty: 2,
        desc: '两张 · 原价≤30元可用',
      },
      {
        id: 'off7',
        title: '7折优惠券×2',
        type: 'percent',
        weight: DEFAULT_PRIZE_WEIGHTS.off7,
        discountFactor: 0.7,
        maxOriginal: 30,
        qty: 2,
        desc: '两张 · 原价≤30元可用',
      },
      {
        id: 'off6',
        title: '6折优惠券×2',
        type: 'percent',
        weight: DEFAULT_PRIZE_WEIGHTS.off6,
        discountFactor: 0.6,
        maxOriginal: 30,
        qty: 2,
        desc: '两张 · 原价≤30元可用',
      },
    ],
  };
}

const SPECIAL_200 = {
  id: 'special200',
  title: '特奖200元',
  type: 'flat',
  weight: DEFAULT_PRIZE_WEIGHTS.special200,
  amount: 20,
  threshold: 0,
  qty: 10,
  stock: 2,
  desc: '特殊奖 · 千分之一 · 仅2个名额 · 20元无门槛券×10',
};

function isLotteryTestMode(lottery) {
  if (lottery && lottery.testMode === true) return true;
  if (lottery && lottery.testMode === false) return false;
  // 本地 mock / 显式环境变量：方便联调，不限日期与次数
  return process.env.LOTTERY_TEST_MODE === '1' || process.env.PAY_MODE === 'mock';
}

/** 测试账号：白名单手机号 / openid，或开发 mock openid（dev_*） */
function isLotteryTester(user, lottery) {
  if (!user) return false;
  const phones = [
    ...((lottery && lottery.testPhones) || []),
    ...String(process.env.LOTTERY_TEST_PHONES || '')
      .split(/[,;\s]+/)
      .filter(Boolean),
    '13800138000', // 开发模拟号
  ];
  if (user.phone && phones.map(String).includes(String(user.phone))) return true;
  const openids = [
    ...((lottery && lottery.testOpenIds) || []),
    ...String(process.env.LOTTERY_TEST_OPENIDS || '')
      .split(/[,;\s]+/)
      .filter(Boolean),
  ];
  if (user.openid && openids.includes(String(user.openid))) return true;
  if (user.openid && String(user.openid).startsWith('dev_')) return true;
  return false;
}

function lotteryUnlimited(user, lottery) {
  return isLotteryTestMode(lottery) || isLotteryTester(user, lottery);
}

function ensureLottery(db) {
  if (!db.lottery || typeof db.lottery !== 'object') {
    db.lottery = defaultLottery();
  }
  if (!Array.isArray(db.lotteryDraws)) db.lotteryDraws = [];
  // 仅缺省或非数组时播种；空奖池视为后台已清空，禁止回填默认奖品
  if (!Array.isArray(db.lottery.prizes)) {
    db.lottery.prizes = defaultLottery().prizes;
  } else if (db.lottery.prizes.length) {
    // 奖池不含「谢谢参与」：一律必中券/实物类奖品
    const filtered = db.lottery.prizes.filter(
      (p) => p && p.id !== 'thanks' && p.type !== 'none'
    );
    if (filtered.length !== db.lottery.prizes.length) {
      db.lottery.prizes = filtered.length ? filtered : defaultLottery().prizes;
    }
    // 旧「水果零售免单 / 零售什锦免单」→ 15元无门槛券
    db.lottery.prizes = db.lottery.prizes.map((p) => {
      if (
        p &&
        (p.id === 'mix_free' ||
          p.type === 'free_item' ||
          /水果零售免单|零售什锦免单/.test(p.title || ''))
      ) {
        return {
          id: 'flat15',
          title: '15元无门槛券',
          type: 'flat',
          weight: Number(p.weight) > 0 ? Number(p.weight) : DEFAULT_PRIZE_WEIGHTS.flat15,
          amount: 15,
          threshold: 0,
          qty: 1,
          desc: '无门槛立减15元，现取预定均可',
        };
      }
      return p;
    });
    // 6/7/8 折默认发 2 张
    for (const p of db.lottery.prizes) {
      if (p && p.type === 'percent' && (p.qty == null || p.qty < 1)) {
        p.qty = 2;
        if (p.title && !/×\s*\d+|x\s*\d+/i.test(p.title)) {
          p.title = `${String(p.title).replace(/×\s*\d+$/, '').trim()}×2`;
        }
        if (p.desc && !/两张|2\s*张/.test(p.desc)) {
          p.desc = `两张 · ${p.desc}`;
        }
      }
    }
    // 幂等补上特殊奖 200 元（20元×10，限 2 名）
    if (!db.lottery.prizes.some((p) => p && p.id === SPECIAL_200.id)) {
      db.lottery.prizes.unshift({ ...SPECIAL_200 });
    } else {
      db.lottery.prizes = db.lottery.prizes.map((p) => {
        if (!p || p.id !== SPECIAL_200.id) return p;
        return {
          ...p,
          title: p.title || SPECIAL_200.title,
          type: 'flat',
          amount: Number(p.amount) > 0 ? Number(p.amount) : 20,
          threshold: p.threshold != null ? Number(p.threshold) : 0,
          qty: p.qty != null ? Math.max(1, Math.floor(Number(p.qty))) : 10,
          stock: p.stock != null ? Math.max(0, Math.floor(Number(p.stock))) : 2,
          desc: p.desc || SPECIAL_200.desc,
          weight: Number(p.weight) > 0 ? Number(p.weight) : DEFAULT_PRIZE_WEIGHTS.special200,
        };
      });
    }
    // 旧奖池总权重约 101（特奖≈1%）→ 放大到 1000（特奖千分之一）
    {
      const sum = db.lottery.prizes.reduce((s, p) => s + (Number(p && p.weight) || 0), 0);
      const special = db.lottery.prizes.find((p) => p && p.id === SPECIAL_200.id);
      if (special && Number(special.weight) === 1 && sum > 0 && sum <= 120) {
        for (const p of db.lottery.prizes) {
          if (!p || p.id == null) continue;
          if (DEFAULT_PRIZE_WEIGHTS[p.id] != null) {
            p.weight = DEFAULT_PRIZE_WEIGHTS[p.id];
          }
        }
      }
    }
  }
  if (!Array.isArray(db.lottery.rules)) {
    db.lottery.rules = defaultLottery().rules;
  } else if (!db.lottery.rules.some((r) => /200元|特殊奖/.test(String(r)))) {
    db.lottery.rules = [
      db.lottery.rules[0],
      '特殊奖「200元券包」中奖率约千分之一，仅 2 个名额：20元无门槛券×10，抽完即止',
      ...db.lottery.rules.slice(1),
    ].filter(Boolean);
  } else {
    db.lottery.rules = db.lottery.rules.map((r) => {
      if (!/200元|特殊奖/.test(String(r))) return r;
      if (/千分之一|0\.1%/.test(String(r))) return r;
      return '特殊奖「200元券包」中奖率约千分之一，仅 2 个名额：20元无门槛券×10，抽完即止';
    });
  }
  // 不再因测试模式强制开启；开业转盘已下线，由管理端显式开关
  return db.lottery;
}

function dayStamp(dateStr, endOfDay = false) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = endOfDay ? `${s}T23:59:59+08:00` : `${s}T00:00:00+08:00`;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function shanghaiDateKey(now = Date.now()) {
  const p = shopParts(now);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function activityWindow(lottery, now = Date.now()) {
  const start = dayStamp(lottery.startDate, false);
  const end = dayStamp(lottery.endDate, true);
  if (start != null && now < start) {
    return { ok: false, reason: '活动尚未开始', code: 'not_started' };
  }
  if (end != null && now > end) {
    return { ok: false, reason: '活动已结束', code: 'ended' };
  }
  return { ok: true, start, end };
}

function isActive(lottery, now = Date.now()) {
  if (!lottery || !lottery.enabled) return false;
  return activityWindow(lottery, now).ok;
}

function findUserDraw(db, userId, lotteryId) {
  return (db.lotteryDraws || []).find(
    (d) => d.userId === userId && d.lotteryId === (lotteryId || d.lotteryId)
  );
}

function prizeDrawnCount(db, lotteryId, prizeId) {
  return (db.lotteryDraws || []).filter(
    (d) => d.lotteryId === lotteryId && d.prizeId === prizeId
  ).length;
}

function prizeRemaining(prize, drawn) {
  if (prize == null || prize.stock == null) return null; // 不限
  const stock = Math.max(0, Math.floor(Number(prize.stock)));
  return Math.max(0, stock - (Number(drawn) || 0));
}

function prizePublic(p, drawn = 0) {
  const qty = Math.max(1, Math.floor(Number(p.qty) || 1));
  const stock = p.stock != null ? Math.max(0, Math.floor(Number(p.stock))) : null;
  const remaining = prizeRemaining(p, drawn);
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    weight: Number(p.weight) || 0,
    desc: p.desc || '',
    qty,
    stock,
    remaining,
    amount: p.amount != null ? Number(p.amount) : null,
    threshold: p.threshold != null ? Number(p.threshold) : null,
    discountFactor: p.discountFactor != null ? Number(p.discountFactor) : null,
    maxOriginal: p.maxOriginal != null ? Number(p.maxOriginal) : null,
  };
}

function campaignPublic(db, userId, now = Date.now()) {
  const lottery = ensureLottery(db);
  const user = userId ? (db.users || []).find((u) => u.id === userId) : null;
  const testMode = isLotteryTestMode(lottery);
  const testAccount = isLotteryTester(user, lottery);
  const unlimited = lotteryUnlimited(user, lottery);
  const window = unlimited ? { ok: true } : activityWindow(lottery, now);
  const active = !!(lottery.enabled && window.ok);
  const draw = userId ? findUserDraw(db, userId, lottery.id) : null;
  // 测试模式 / 测试账号：不限次数；正式：活动期内未抽过
  const canDraw = unlimited
    ? !!(lottery.enabled && userId)
    : active && !!userId && !draw;
  return {
    id: lottery.id,
    title: lottery.title,
    subtitle: unlimited ? '测试模式 · 不限次数' : lottery.subtitle,
    enabled: !!lottery.enabled,
    active,
    testMode: unlimited,
    testAccount: !!(testAccount || testMode),
    /** 进店每次弹转盘（测试期 / 测试账号） */
    popEveryVisit: unlimited,
    startDate: unlimited ? '' : lottery.startDate || '',
    endDate: unlimited ? '' : lottery.endDate || '',
    today: shanghaiDateKey(now),
    windowReason: lottery.enabled ? window.reason || '' : '活动未开启',
    windowCode: lottery.enabled ? window.code || '' : 'disabled',
    rules: unlimited
      ? ['【测试】不校验日期与次数，可反复抽奖', ...(lottery.rules || []).slice(1)]
      : lottery.rules || [],
    prizes: (lottery.prizes || []).map((p) =>
      prizePublic(p, prizeDrawnCount(db, lottery.id, p.id))
    ),
    participated: !!draw,
    myPrize: draw
      ? {
          prizeId: draw.prizeId,
          title: draw.title,
          type: draw.type,
          couponId: draw.couponId || null,
          drawnAt: draw.drawnAt,
        }
      : null,
    canDraw,
  };
}

function pickPrize(prizes, drawnByPrize = {}) {
  const list = (prizes || []).filter((p) => {
    if (!(Number(p.weight) > 0)) return false;
    // stock 有值则限量；抽完从奖池剔除
    if (p.stock != null) {
      const left = prizeRemaining(p, drawnByPrize[p.id] || 0);
      if (!(left > 0)) return false;
    }
    return true;
  });
  if (!list.length) return null;
  const total = list.reduce((s, p) => s + Number(p.weight), 0);
  let r = Math.random() * total;
  for (const p of list) {
    r -= Number(p.weight);
    if (r <= 0) return p;
  }
  return list[list.length - 1];
}

function grantPrizeCoupon(db, user, prize, now = Date.now(), validDays = VALID_DAYS) {
  if (!prize || prize.type === 'none') return [];
  ensureCoupons(db);
  const qty = Math.max(1, Math.floor(Number(prize.qty) || 1));
  const expireAt = now + (Number(validDays) || VALID_DAYS) * 24 * 60 * 60 * 1000;
  const granted = [];
  for (let i = 0; i < qty; i += 1) {
    const coupon = {
      id: crypto.randomUUID(),
      userId: user.id,
      openid: user.openid || null,
      pack: LOTTERY_PACK,
      templateId: `lottery_${prize.id}`,
      title: prize.title,
      type: prize.type,
      threshold: 0,
      amount: 0,
      fulfillment: 'any',
      status: 'unused',
      orderId: null,
      grantedAt: now,
      expireAt,
      usedAt: null,
      lotteryPrizeId: prize.id,
    };

    if (prize.type === 'percent') {
      coupon.discountFactor = Number(prize.discountFactor);
      coupon.maxOriginal = Number(prize.maxOriginal) || 30;
      coupon.amount = 0;
      // 单张券名称不带 ×2，避免展示重复
      coupon.title = String(prize.title || '')
        .replace(/×\s*\d+\s*$/u, '')
        .replace(/\s*x\s*\d+\s*$/i, '')
        .trim() || prize.title;
    } else if (prize.type === 'flat' || prize.type === 'reserve_off') {
      coupon.type = prize.type === 'reserve_off' ? 'reserve_off' : 'flat';
      coupon.amount = Number(prize.amount) || 0;
      coupon.threshold = Number(prize.threshold) || 0;
      coupon.fulfillment = prize.type === 'reserve_off' ? 'reserve' : 'any';
      if (!(coupon.amount > 0)) return [];
      // 多张时单券名用面额，避免「200元券包」重复出现在每张上
      if (qty > 1) {
        coupon.title =
          coupon.type === 'reserve_off'
            ? `${coupon.amount}元预定立减券`
            : `${coupon.amount}元无门槛券`;
      }
    } else if (prize.type === 'free_item') {
      coupon.matchCategory = prize.matchCategory || '水果零售';
      coupon.matchNameIncludes = prize.matchNameIncludes || '零售';
      if (Array.isArray(prize.productIds)) coupon.productIds = prize.productIds;
      coupon.amount = 0;
    } else {
      return [];
    }

    db.coupons.push(coupon);
    granted.push(coupon);
  }
  return granted;
}

function drawLottery(db, user, now = Date.now()) {
  if (!user || !user.id) {
    throw Object.assign(new Error('请先登录'), { status: 401 });
  }
  const lottery = ensureLottery(db);
  const unlimited = lotteryUnlimited(user, lottery);
  if (!lottery.enabled) {
    throw Object.assign(new Error('活动尚未开启'), { status: 400 });
  }
  if (!unlimited) {
    const window = activityWindow(lottery, now);
    if (!window.ok) {
      throw Object.assign(new Error(window.reason), { status: 400 });
    }
    if (findUserDraw(db, user.id, lottery.id)) {
      throw Object.assign(new Error('您已参与过本次抽奖'), { status: 400 });
    }
  }

  const drawnByPrize = {};
  for (const d of db.lotteryDraws || []) {
    if (d.lotteryId !== lottery.id) continue;
    drawnByPrize[d.prizeId] = (drawnByPrize[d.prizeId] || 0) + 1;
  }
  const prize = pickPrize(lottery.prizes, drawnByPrize);
  if (!prize) {
    throw Object.assign(new Error('奖池未配置或限量奖已抽完'), { status: 500 });
  }

  const coupons = grantPrizeCoupon(db, user, prize, now, lottery.validDays);
  const record = {
    id: crypto.randomUUID(),
    lotteryId: lottery.id,
    userId: user.id,
    openid: user.openid || null,
    prizeId: prize.id,
    title: prize.title,
    type: prize.type,
    qty: coupons.length || 1,
    couponId: coupons[0] ? coupons[0].id : null,
    couponIds: coupons.map((c) => c.id),
    drawnAt: now,
  };
  db.lotteryDraws.push(record);

  return {
    prize: prizePublic(prize, (drawnByPrize[prize.id] || 0) + 1),
    couponId: coupons[0] ? coupons[0].id : null,
    couponIds: coupons.map((c) => c.id),
    qty: coupons.length || 1,
    drawnAt: now,
    campaign: campaignPublic(db, user.id, now),
  };
}

function normalizeAdminBody(body = {}, current) {
  const next = { ...current };
  if (body.title != null) next.title = String(body.title).trim() || next.title;
  if (body.subtitle != null) next.subtitle = String(body.subtitle);
  if (body.enabled != null) next.enabled = !!body.enabled;
  if (body.startDate != null) next.startDate = String(body.startDate).trim();
  if (body.endDate != null) next.endDate = String(body.endDate).trim();
  if (body.validDays != null) {
    const d = Number(body.validDays);
    if (d >= 1 && d <= 365) next.validDays = Math.floor(d);
  }
  if (Array.isArray(body.rules)) next.rules = body.rules.map(String);
  if (Array.isArray(body.prizes) && body.prizes.length) {
    next.prizes = body.prizes.map((p, i) => {
      const row = {
        id: String(p.id || `p${i}`),
        title: String(p.title || '奖品'),
        type: ['percent', 'flat', 'free_item', 'none'].includes(p.type) ? p.type : 'none',
        weight: Math.max(0, Number(p.weight) || 0),
        desc: String(p.desc || ''),
        qty: Math.max(1, Math.floor(Number(p.qty) || (p.type === 'percent' ? 2 : 1))),
        amount: p.amount != null ? Number(p.amount) : undefined,
        threshold: p.threshold != null ? Number(p.threshold) : undefined,
        discountFactor: p.discountFactor != null ? Number(p.discountFactor) : undefined,
        maxOriginal: p.maxOriginal != null ? Number(p.maxOriginal) : undefined,
        matchCategory: p.matchCategory || undefined,
        matchNameIncludes: p.matchNameIncludes || undefined,
        productIds: Array.isArray(p.productIds) ? p.productIds : undefined,
      };
      if (p.stock != null && p.stock !== '') {
        row.stock = Math.max(0, Math.floor(Number(p.stock)));
      }
      return row;
    });
    const sum = next.prizes.reduce((s, p) => s + p.weight, 0);
    if (!(sum > 0)) {
      throw Object.assign(new Error('奖品权重合计须大于 0'), { status: 400 });
    }
  }
  if (next.startDate && next.endDate && next.startDate > next.endDate) {
    throw Object.assign(new Error('开始日期不能晚于结束日期'), { status: 400 });
  }
  return next;
}

function updateLottery(db, body) {
  const current = ensureLottery(db);
  db.lottery = normalizeAdminBody(body, current);
  return db.lottery;
}

function adminStats(db) {
  const lottery = ensureLottery(db);
  const draws = (db.lotteryDraws || []).filter((d) => d.lotteryId === lottery.id);
  const byPrize = {};
  for (const d of draws) {
    byPrize[d.prizeId] = (byPrize[d.prizeId] || 0) + 1;
  }
  return {
    lottery,
    drawCount: draws.length,
    byPrize,
  };
}

module.exports = {
  LOTTERY_PACK,
  defaultLottery,
  ensureLottery,
  campaignPublic,
  drawLottery,
  updateLottery,
  adminStats,
  isActive,
  shanghaiDateKey,
};
