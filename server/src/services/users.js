/**
 * 用户活跃度：按最近支付订单 / 最近登录划分，供管理端定向发券
 */
const PAID = new Set(['paid', 'making', 'ready', 'done']);

/** 默认：14 天内有支付单 = 活跃；更久或从未下单 = 不活跃 */
const DEFAULT_ACTIVE_DAYS = Number(process.env.USER_ACTIVE_DAYS || 14);

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

function listUsersWithActivity(db, { segment = 'all', activeDays = DEFAULT_ACTIVE_DAYS, now = Date.now() } = {}) {
  const users = Array.isArray(db.users) ? db.users : [];
  const list = users.map((u) => {
    const stats = orderStatsForUser(db, u.id);
    const lastOrderAt = Math.max(Number(u.lastOrderAt) || 0, stats.lastOrderAt || 0);
    const lastLoginAt = Number(u.lastLoginAt) || Number(u.createdAt) || 0;
    const paidCount = Math.max(Number(u.orderCount) || 0, stats.paidCount);
    const row = {
      id: u.id,
      openid: u.openid || '',
      nickName: u.nickName || '果粉',
      phone: u.phone || '',
      createdAt: u.createdAt || 0,
      lastLoginAt,
      lastOrderAt,
      paidCount,
      paidAmount: stats.paidAmount,
    };
    row.segment = classifyUser(row, { now, activeDays });
    return row;
  });

  list.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));

  const filtered =
    segment === 'active' || segment === 'inactive'
      ? list.filter((u) => u.segment === segment)
      : list;

  const summary = {
    total: list.length,
    active: list.filter((u) => u.segment === 'active').length,
    inactive: list.filter((u) => u.segment === 'inactive').length,
    activeDays: Number(activeDays) || DEFAULT_ACTIVE_DAYS,
  };

  return { list: filtered, summary };
}

module.exports = {
  DEFAULT_ACTIVE_DAYS,
  touchLogin,
  touchOrderPaid,
  listUsersWithActivity,
  classifyUser,
  orderStatsForUser,
};
