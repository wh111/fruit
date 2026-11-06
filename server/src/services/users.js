/**
 * 用户活跃度：按最近支付订单 / 最近登录划分，供管理端定向发券
 * 管理端也可维护会员资料（昵称 / 手机 / 备注）与余额
 */
const PAID = new Set(['paid', 'making', 'ready', 'done']);

/** 默认：14 天内有支付单 = 活跃；更久或从未下单 = 不活跃 */
const DEFAULT_ACTIVE_DAYS = Number(process.env.USER_ACTIVE_DAYS || 14);

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function dayMs(days) {
  return Math.max(1, Number(days) || DEFAULT_ACTIVE_DAYS) * 24 * 60 * 60 * 1000;
}

function touchLogin(user, now = Date.now()) {
  if (!user) return;
  user.lastLoginAt = now;
  user.updatedAt = now;
}

function touchOrderPaid(db, order, now = Date.now()) {
  if (!order?.userId) return;
  const user = (db.users || []).find((u) => u.id === order.userId);
  if (!user) return;
  user.lastOrderAt = now;
  user.orderCount = (Number(user.orderCount) || 0) + 1;
  user.updatedAt = now;
}

function orderStatsForUser(db, userId) {
  const orders = (db.orders || []).filter(
    (o) => o.userId === userId && PAID.has(o.status)
  );
  let lastOrderAt = 0;
  let paidCount = 0;
  let paidAmount = 0;
  for (const o of orders) {
    paidCount += 1;
    paidAmount += Number(o.amount) || 0;
    const t = o.paidAt || o.createdAt || 0;
    if (t > lastOrderAt) lastOrderAt = t;
  }
  return { paidCount, paidAmount: Math.round(paidAmount * 100) / 100, lastOrderAt };
}

function classifyUser(row, { now = Date.now(), activeDays = DEFAULT_ACTIVE_DAYS } = {}) {
  const cutoff = now - dayMs(activeDays);
  const lastOrderAt = row.lastOrderAt || 0;
  if (lastOrderAt >= cutoff) return 'active';
  return 'inactive';
}

function couponSummaryForUser(db, userId) {
  const coupons = (db.coupons || []).filter((c) => c.userId === userId);
  const unused = coupons.filter((c) => c.status === 'unused').length;
  const used = coupons.filter((c) => c.status === 'used').length;
  return { total: coupons.length, unused, used };
}

function listUsersWithActivity(
  db,
  {
    segment = 'all',
    activeDays = DEFAULT_ACTIVE_DAYS,
    now = Date.now(),
    q = '',
    page,
    pageSize,
  } = {}
) {
  const users = Array.isArray(db.users) ? db.users : [];
  const keyword = String(q || '').trim().toLowerCase();
  const list = users.map((u) => {
    const stats = orderStatsForUser(db, u.id);
    const lastOrderAt = Math.max(Number(u.lastOrderAt) || 0, stats.lastOrderAt || 0);
    const lastLoginAt = Number(u.lastLoginAt) || Number(u.createdAt) || 0;
    const paidCount = Math.max(Number(u.orderCount) || 0, stats.paidCount);
    let balance = Math.round((Number(u.balance) || 0) * 100) / 100;
    try {
      const { getBalance } = require('./wallet');
      balance = getBalance(db, u.id);
    } catch {
      /* ignore */
    }
    const coupons = couponSummaryForUser(db, u.id);
    const row = {
      id: u.id,
      openid: u.openid || '',
      nickName: u.nickName || '果粉',
      phone: u.phone || '',
      note: u.note || '',
      createdAt: u.createdAt || 0,
      lastLoginAt,
      lastOrderAt,
      paidCount,
      paidAmount: stats.paidAmount,
      balance,
      couponUnused: coupons.unused,
    };
    row.segment = classifyUser(row, { now, activeDays });
    return row;
  });

  list.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));

  let filtered =
    segment === 'active' || segment === 'inactive'
      ? list.filter((u) => u.segment === segment)
      : list;

  if (keyword) {
    filtered = filtered.filter((u) => {
      const phone = String(u.phone || '');
      const name = String(u.nickName || '').toLowerCase();
      const note = String(u.note || '').toLowerCase();
      const id = String(u.id || '').toLowerCase();
      return (
        phone.includes(keyword) ||
        name.includes(keyword) ||
        note.includes(keyword) ||
        id.includes(keyword)
      );
    });
  }

  const summary = {
    total: list.length,
    active: list.filter((u) => u.segment === 'active').length,
    inactive: list.filter((u) => u.segment === 'inactive').length,
    activeDays: Number(activeDays) || DEFAULT_ACTIVE_DAYS,
    filtered: filtered.length,
  };

  const sizeRaw = Number(pageSize);
  const usePaging = Number.isFinite(sizeRaw) && sizeRaw > 0;
  const size = usePaging ? Math.min(100, Math.max(1, Math.floor(sizeRaw))) : filtered.length || 1;
  const pageRaw = Number(page);
  const pageNum = usePaging
    ? Math.max(1, Math.floor(Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1))
    : 1;
  const pages = usePaging ? Math.max(1, Math.ceil(filtered.length / size)) : 1;
  const safePage = Math.min(pageNum, pages);
  const start = usePaging ? (safePage - 1) * size : 0;
  const paged = usePaging ? filtered.slice(start, start + size) : filtered;

  return {
    list: paged,
    summary,
    page: safePage,
    pageSize: usePaging ? size : filtered.length,
    pages,
    total: filtered.length,
  };
}

function getUserAdminDetail(db, userId) {
  const user = (db.users || []).find((u) => u.id === userId);
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 });
  }
  const { list } = listUsersWithActivity(db, { segment: 'all' });
  const row = list.find((u) => u.id === userId) || {
    id: user.id,
    nickName: user.nickName || '果粉',
    phone: user.phone || '',
    note: user.note || '',
    balance: 0,
  };
  let ledger = [];
  try {
    const { ensureWallet } = require('./wallet');
    ensureWallet(db);
    ledger = (db.walletLedger || [])
      .filter((x) => x.userId === userId)
      .slice(0, 30)
      .map((x) => ({
        id: x.id,
        type: x.type,
        amount: x.amount,
        balanceAfter: x.balanceAfter,
        note: x.note || '',
        orderId: x.orderId || null,
        createdAt: x.createdAt,
      }));
  } catch {
    ledger = [];
  }
  const coupons = (db.coupons || [])
    .filter((c) => c.userId === userId)
    .slice(0, 40)
    .map((c) => ({
      id: c.id,
      title: c.title || '',
      amount: c.amount,
      threshold: c.threshold,
      status: c.status,
      expiresAt: c.expiresAt || null,
      createdAt: c.createdAt || null,
    }));
  return {
    user: row,
    ledger,
    coupons,
    couponSummary: couponSummaryForUser(db, userId),
  };
}

function updateUserAdmin(db, userId, body = {}) {
  const user = (db.users || []).find((u) => u.id === userId);
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 });
  }
  if (body.nickName != null) {
    const name = String(body.nickName).trim();
    if (!name) throw Object.assign(new Error('昵称不能为空'), { status: 400 });
    user.nickName = name.slice(0, 32);
  }
  if (body.phone != null) {
    const phone = normalizePhone(body.phone);
    if (phone && !/^1\d{10}$/.test(phone)) {
      throw Object.assign(new Error('手机号格式不正确'), { status: 400 });
    }
    if (phone) {
      const occupied = (db.users || []).find((u) => u.id !== userId && normalizePhone(u.phone) === phone);
      if (occupied) {
        throw Object.assign(new Error('该手机号已绑定其他会员'), { status: 400 });
      }
    }
    user.phone = phone;
  }
  if (body.note != null) {
    user.note = String(body.note).trim().slice(0, 200);
  }
  user.updatedAt = Date.now();
  return getUserAdminDetail(db, userId);
}

function adjustUserBalance(db, userId, body = {}) {
  const user = (db.users || []).find((u) => u.id === userId);
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 });
  }
  const { getBalance, credit, debit } = require('./wallet');
  const note = String(body.note || '').trim() || '后台调整';
  const current = getBalance(db, userId);
  let ledgerRow = null;
  if (body.setTo != null && body.setTo !== '') {
    const target = Math.round(Number(body.setTo) * 100) / 100;
    if (!Number.isFinite(target) || target < 0) {
      throw Object.assign(new Error('目标余额无效'), { status: 400 });
    }
    const delta = Math.round((target - current) * 100) / 100;
    if (delta > 0) {
      ledgerRow = credit(db, userId, delta, { type: 'admin_adjust', note: `${note}（设为 ¥${target.toFixed(2)}）` });
    } else if (delta < 0) {
      ledgerRow = debit(db, userId, -delta, { type: 'admin_adjust', note: `${note}（设为 ¥${target.toFixed(2)}）` });
    }
  } else {
    const delta = Math.round(Number(body.delta) * 100) / 100;
    if (!Number.isFinite(delta) || delta === 0) {
      throw Object.assign(new Error('请填写调整金额'), { status: 400 });
    }
    if (delta > 0) {
      ledgerRow = credit(db, userId, delta, { type: 'admin_adjust', note });
    } else {
      ledgerRow = debit(db, userId, -delta, { type: 'admin_adjust', note });
    }
  }
  const detail = getUserAdminDetail(db, userId);
  return { ...detail, ledgerRow };
}

module.exports = {
  DEFAULT_ACTIVE_DAYS,
  touchLogin,
  touchOrderPaid,
  listUsersWithActivity,
  classifyUser,
  orderStatsForUser,
  getUserAdminDetail,
  updateUserAdmin,
  adjustUserBalance,
};
