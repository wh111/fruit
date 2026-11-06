/**
 * 储值：可配置档位（充本金送赠金）+ 整单余额支付
 */
const crypto = require('crypto');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function defaultWalletConfig() {
  return {
    enabled: true,
    tiers: [
      { id: 't100', payAmount: 100, bonus: 5, title: '充100送5', enabled: true },
      { id: 't200', payAmount: 200, bonus: 15, title: '充200送15', enabled: true },
      { id: 't500', payAmount: 500, bonus: 40, title: '充500送40', enabled: true },
    ],
  };
}

function ensureWallet(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  // 仅在配置缺失时播种；空 tiers 视为后台已清空，禁止回填默认档位
  if (!db.settings.wallet || typeof db.settings.wallet !== 'object') {
    db.settings.wallet = defaultWalletConfig();
  } else {
    const w = db.settings.wallet;
    if (w.enabled == null) w.enabled = true;
    if (!Array.isArray(w.tiers)) {
      w.tiers = defaultWalletConfig().tiers;
    }
  }
  if (!Array.isArray(db.walletLedger)) db.walletLedger = [];
  if (!Array.isArray(db.recharges)) db.recharges = [];
  return db.settings.wallet;
}

function getConfig(db) {
  return ensureWallet(db);
}

function publicConfig(db) {
  const cfg = ensureWallet(db);
  return {
    enabled: !!cfg.enabled,
    tiers: (cfg.tiers || [])
      .filter((t) => t && t.enabled !== false && Number(t.payAmount) > 0)
      .map((t) => ({
        id: t.id,
        payAmount: round2(t.payAmount),
        bonus: round2(t.bonus || 0),
        creditAmount: round2(Number(t.payAmount) + Number(t.bonus || 0)),
        title: t.title || `充${t.payAmount}送${t.bonus || 0}`,
      })),
  };
}

function updateConfig(db, body = {}) {
  ensureWallet(db);
  const next = { ...db.settings.wallet };
  if (body.enabled != null) next.enabled = !!body.enabled;
  if (Array.isArray(body.tiers)) {
    const tiers = body.tiers
      .map((t, i) => {
        const payAmount = round2(t.payAmount);
        const bonus = round2(t.bonus || 0);
        if (!(payAmount > 0) || bonus < 0) return null;
        return {
          id: String(t.id || `t${i}_${Math.round(payAmount)}`),
          payAmount,
          bonus,
          title: String(t.title || `充${payAmount}送${bonus}`).trim(),
          enabled: t.enabled !== false,
        };
      })
      .filter(Boolean);
    if (!tiers.length) {
      throw Object.assign(new Error('至少保留一个有效档位'), { status: 400 });
    }
    next.tiers = tiers;
  }
  db.settings.wallet = next;
  return next;
}

function getBalance(db, userId) {
  if (!userId) return 0;
  const user = (db.users || []).find((u) => u.id === userId);
  if (user && user.balance != null && Number.isFinite(Number(user.balance))) {
    return round2(user.balance);
  }
  // 兜底：按流水汇总
  let bal = 0;
  for (const row of db.walletLedger || []) {
    if (row.userId !== userId) continue;
    bal = round2(bal + Number(row.amount || 0));
  }
  if (user) user.balance = bal;
  return bal;
}

function setBalance(db, userId, balance) {
  const user = (db.users || []).find((u) => u.id === userId);
  if (user) user.balance = round2(balance);
  if (!db.walletBalances || typeof db.walletBalances !== 'object') db.walletBalances = {};
  db.walletBalances[userId] = round2(balance);
}

function appendLedger(db, { userId, type, amount, orderId, rechargeId, note }) {
  const delta = round2(amount);
  const before = getBalance(db, userId);
  const after = round2(before + delta);
  if (after < -0.001) {
    throw Object.assign(new Error('余额不足'), { status: 400 });
  }
  const safeAfter = Math.max(0, after);
  setBalance(db, userId, safeAfter);
  const row = {
    id: crypto.randomUUID(),
    userId,
    type,
    amount: delta,
    balanceAfter: safeAfter,
    orderId: orderId || null,
    rechargeId: rechargeId || null,
    note: note || '',
    createdAt: Date.now(),
  };
  db.walletLedger.unshift(row);
  return row;
}

function credit(db, userId, amount, meta = {}) {
  const n = round2(amount);
  if (!(n > 0)) throw Object.assign(new Error('入账金额无效'), { status: 400 });
  return appendLedger(db, {
    userId,
    type: meta.type || 'recharge',
    amount: n,
    orderId: meta.orderId,
    rechargeId: meta.rechargeId,
    note: meta.note || '',
  });
}

function debit(db, userId, amount, meta = {}) {
  const n = round2(amount);
  if (!(n > 0)) throw Object.assign(new Error('扣款金额无效'), { status: 400 });
  const bal = getBalance(db, userId);
  if (bal + 0.001 < n) {
    throw Object.assign(new Error(`余额不足（当前 ¥${bal.toFixed(2)}）`), { status: 400 });
  }
  return appendLedger(db, {
    userId,
    type: meta.type || 'order_pay',
    amount: -n,
    orderId: meta.orderId,
    rechargeId: meta.rechargeId,
    note: meta.note || '',
  });
}

function findTier(db, tierId) {
  const cfg = ensureWallet(db);
  return (cfg.tiers || []).find((t) => t && t.id === tierId && t.enabled !== false);
}

function createRecharge(db, user, tierId) {
  ensureWallet(db);
  const cfg = db.settings.wallet;
  if (!cfg.enabled) {
    throw Object.assign(new Error('储值活动未开启'), { status: 400 });
  }
  if (!user?.id) {
    throw Object.assign(new Error('请先登录'), { status: 401 });
  }
  const tier = findTier(db, tierId);
  if (!tier) {
    throw Object.assign(new Error('档位不存在或已下架'), { status: 400 });
  }
  const payAmount = round2(tier.payAmount);
  const bonus = round2(tier.bonus || 0);
  const now = Date.now();
  const recharge = {
    id: crypto.randomUUID(),
    orderNo: `WR${now}${Math.floor(Math.random() * 900 + 100)}`,
    userId: user.id,
    openid: user.openid || null,
    tierId: tier.id,
    title: tier.title || `充${payAmount}送${bonus}`,
    payAmount,
    bonus,
    creditAmount: round2(payAmount + bonus),
    status: 'pending_pay',
    payMode: null,
    transactionId: null,
    prepayId: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.recharges.unshift(recharge);
  return recharge;
}

function markRechargePaid(db, rechargeId, { transactionId, payMode } = {}) {
  ensureWallet(db);
  const recharge = (db.recharges || []).find((r) => r.id === rechargeId);
  if (!recharge) throw Object.assign(new Error('充值单不存在'), { status: 404 });
  if (recharge.status === 'paid') return recharge;
  if (recharge.status !== 'pending_pay') {
    throw Object.assign(new Error('充值单状态不可支付'), { status: 400 });
  }
  credit(db, recharge.userId, recharge.creditAmount, {
    type: 'recharge',
    rechargeId: recharge.id,
    note: `${recharge.title}（本金${recharge.payAmount}+赠${recharge.bonus}）`,
  });
  recharge.status = 'paid';
  recharge.transactionId = transactionId || `MOCK${Date.now()}`;
  recharge.payMode = payMode || process.env.PAY_MODE || 'mock';
  recharge.paidAt = Date.now();
  recharge.updatedAt = Date.now();
  return recharge;
}

function minePayload(db, userId) {
  ensureWallet(db);
  const balance = getBalance(db, userId);
  return {
    balance,
    ...publicConfig(db),
  };
}

/** 手机号合并时迁移余额与流水 */
function transferWalletOnMerge(db, fromUserId, toUserId) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;
  ensureWallet(db);
  for (const row of db.walletLedger || []) {
    if (row.userId === fromUserId) row.userId = toUserId;
  }
  for (const r of db.recharges || []) {
    if (r.userId === fromUserId) r.userId = toUserId;
  }
  const fromBal = getBalance(db, fromUserId);
  if (fromBal > 0) {
    // 清空 from，累加到 to（流水已改挂 to，需重算）
    let toBal = 0;
    for (const row of db.walletLedger || []) {
      if (row.userId === toUserId) toBal = round2(toBal + Number(row.amount || 0));
    }
    setBalance(db, toUserId, Math.max(0, toBal));
    setBalance(db, fromUserId, 0);
  }
}

function hydrateBalances(db) {
  ensureWallet(db);
  const map = db.walletBalances && typeof db.walletBalances === 'object' ? db.walletBalances : {};
  for (const u of db.users || []) {
    if (u.balance == null && map[u.id] != null) {
      u.balance = round2(map[u.id]);
    } else if (u.balance == null) {
      u.balance = getBalance(db, u.id);
    }
  }
}

module.exports = {
  defaultWalletConfig,
  ensureWallet,
  getConfig,
  publicConfig,
  updateConfig,
  getBalance,
  credit,
  debit,
  createRecharge,
  markRechargePaid,
  minePayload,
  transferWalletOnMerge,
  hydrateBalances,
  findTier,
};
