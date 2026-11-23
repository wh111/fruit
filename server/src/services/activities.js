/**
 * 活动中心：
 * - 进行中：本周可配置活动（settings.weeklyActivities.current）
 * - 已过期：往期周归档 + 下线的固定活动
 * - 会员折扣 / 充值有礼：常驻入口（不占本周档期）
 */
const crypto = require('crypto');
const {
  campaignInfo,
  getPromoPopupPublic,
  ensureFruitRetailOff,
  ensureCanePromo,
  hasFruitRetailOffToday,
  hasCanePromoToday,
  PROMO_LATE_THRESHOLD,
  FRUIT_PROMO_TITLE,
  FRUIT_PROMO_SUB,
  FRUIT_PROMO_DETAIL,
  CANE_PROMO_TITLE,
  CANE_PROMO_SUB,
  CANE_PROMO_DETAIL,
} = require('./coupon');
const { getMemberDiscountPublic, getLoyaltyState } = require('./loyalty');
const { ensureLottery, campaignPublic: lotteryCampaign } = require('./lottery');
const { publicConfig: getWalletPublic } = require('./wallet');
const { shopParts, shopStamp } = require('./promo');

const THEMES = new Set(['warm', 'winter', 'member', 'gold', 'muted', 'default']);
const ACTIONS = new Set(['claim', 'wallet', 'order', 'none']);
const CLAIM_PACKS = new Set(['fruit_retail_off', 'cane_promo', '']);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromParts(p) {
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 门店时区：本周一 00:00 ～ 周日 23:59:59 对应的日期串 */
function weekRangeOf(now = Date.now()) {
  const p = shopParts(now);
  const noon = shopStamp(p.y, p.m, p.d, 12, 0);
  const dow = new Date(noon).getDay(); // 0 Sun … 6 Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(noon);
  mon.setDate(mon.getDate() + offsetToMon);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const mp = shopParts(+mon);
  const sp = shopParts(+sun);
  return {
    startDate: ymdFromParts(mp),
    endDate: ymdFromParts(sp),
    weekLabel: `${mp.y}年${mp.m}月第${Math.ceil(mp.d / 7)}周`,
  };
}

function parseYmd(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function dayStartMs(ymd) {
  const p = parseYmd(ymd);
  if (!p) return null;
  return shopStamp(p.y, p.m, p.d, 0, 0);
}

function dayEndMs(ymd) {
  const p = parseYmd(ymd);
  if (!p) return null;
  return shopStamp(p.y, p.m, p.d, 23, 59) + 59 * 1000;
}

function windowStatus(startDate, endDate, now = Date.now()) {
  const a = dayStartMs(startDate);
  const b = dayEndMs(endDate);
  if (a == null || b == null) return { ok: false, reason: 'bad_date' };
  if (now < a) return { ok: false, reason: 'not_started' };
  if (now > b) return { ok: false, reason: 'expired' };
  return { ok: true, reason: 'active' };
}

function uid() {
  return `wa_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeItem(raw = {}, idx = 0) {
  const theme = THEMES.has(raw.theme) ? raw.theme : 'default';
  const action = ACTIONS.has(raw.action) ? raw.action : 'order';
  let claimPack = String(raw.claimPack || '').trim();
  if (!CLAIM_PACKS.has(claimPack)) claimPack = '';
  const enabled = raw.enabled !== false;
  return {
    id: String(raw.id || uid()),
    enabled,
    tag: String(raw.tag || '本周活动').trim().slice(0, 20) || '本周活动',
    title: String(raw.title || '').trim().slice(0, 40) || `活动${idx + 1}`,
    sub: String(raw.sub || '').trim().slice(0, 120),
    detail: String(raw.detail || '').trim().slice(0, 400),
    theme,
    action,
    actionText: String(raw.actionText || '').trim().slice(0, 12),
    claimPack,
    sort: Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : (idx + 1) * 10,
  };
}

function defaultWeekItems() {
  return [
    {
      id: uid(),
      enabled: true,
      tag: '免洗什锦',
      title: FRUIT_PROMO_TITLE,
      sub: FRUIT_PROMO_SUB,
      detail: FRUIT_PROMO_DETAIL,
      theme: 'warm',
      action: 'claim',
      actionText: '去领取',
      claimPack: 'fruit_retail_off',
      sort: 10,
    },
    {
      id: uid(),
      enabled: true,
      tag: '去皮甘蔗',
      title: CANE_PROMO_TITLE,
      sub: CANE_PROMO_SUB,
      detail: CANE_PROMO_DETAIL,
      theme: 'winter',
      action: 'claim',
      actionText: '去领取',
      claimPack: 'cane_promo',
      sort: 20,
    },
  ];
}

function ensureWeeklyActivities(db, now = Date.now()) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.weeklyActivities;
  const range = weekRangeOf(now);
  if (!cur || typeof cur !== 'object') {
    // 首次：用当前周 + 默认条目；若已开甘蔗/什锦则带上标题
    const fruit = ensureFruitRetailOff(db);
    const cane = ensureCanePromo(db);
    const items = defaultWeekItems();
    if (fruit.title) items[0].title = fruit.title;
    if (cane.title) items[1].title = cane.title;
    const start = fruit.startDate || cane.startDate || range.startDate;
    const end = fruit.endDate || cane.endDate || range.endDate;
    db.settings.weeklyActivities = {
      current: {
        weekLabel: range.weekLabel,
        startDate: start,
        endDate: end,
        hint: '本周活动 · 会员免费参与',
        items,
      },
      history: [],
    };
  } else {
    if (!cur.current || typeof cur.current !== 'object') {
      cur.current = {
        weekLabel: range.weekLabel,
        startDate: range.startDate,
        endDate: range.endDate,
        hint: '本周活动 · 会员免费参与',
        items: defaultWeekItems(),
      };
    } else {
      const c = cur.current;
      c.weekLabel = String(c.weekLabel || range.weekLabel).trim() || range.weekLabel;
      c.startDate = String(c.startDate || range.startDate).trim() || range.startDate;
      c.endDate = String(c.endDate || range.endDate).trim() || range.endDate;
      c.hint = String(c.hint || '').trim();
      c.items = Array.isArray(c.items)
        ? c.items.map((it, i) => {
            const row = normalizeItem(it, i);
            // 旧「立减 / 满9.9不清晰」文案 → 新对客表述
            if (row.claimPack === 'fruit_retail_off') {
              if (/立减|前\d+名无门槛|其余满/.test(`${row.title}${row.sub}`)) {
                row.title = FRUIT_PROMO_TITLE;
                row.sub = FRUIT_PROMO_SUB;
                row.detail = FRUIT_PROMO_DETAIL;
                row.tag = '免洗什锦';
              }
            }
            if (row.claimPack === 'cane_promo') {
              if (/立减|前\d+名无门槛|其余满|用券无门槛|冬日甘蔗/.test(`${row.title}${row.sub}`)) {
                row.title = CANE_PROMO_TITLE;
                row.sub = CANE_PROMO_SUB;
                row.detail = CANE_PROMO_DETAIL;
                row.tag = '去皮甘蔗';
              }
            }
            return row;
          })
        : [];
    }
    if (!Array.isArray(cur.history)) cur.history = [];
    db.settings.weeklyActivities = cur;
  }
  return db.settings.weeklyActivities;
}

function getWeeklyActivitiesPublic(db, now = Date.now()) {
  const cfg = ensureWeeklyActivities(db, now);
  const c = cfg.current;
  const win = windowStatus(c.startDate, c.endDate, now);
  return {
    weekLabel: c.weekLabel,
    startDate: c.startDate,
    endDate: c.endDate,
    hint: c.hint || '',
    status: win.ok ? 'active' : win.reason,
    statusText: win.ok ? '进行中' : win.reason === 'not_started' ? '未开始' : '已结束',
    items: (c.items || []).filter((x) => x.enabled !== false),
    historyCount: (cfg.history || []).length,
  };
}

function getWeeklyActivitiesAdmin(db, now = Date.now()) {
  const cfg = ensureWeeklyActivities(db, now);
  return {
    current: {
      ...cfg.current,
      items: (cfg.current.items || []).map((it, i) => normalizeItem(it, i)),
    },
    history: (cfg.history || []).slice(0, 20),
    suggested: weekRangeOf(now),
    hint:
      '进行中活动按「本周」档期展示。每周改标题/说明/按钮即可；发券仍用上方甘蔗/免洗开关。',
  };
}

function updateWeeklyActivities(db, body = {}, now = Date.now()) {
  const cfg = ensureWeeklyActivities(db, now);
  const c = cfg.current;
  if (body.weekLabel !== undefined) c.weekLabel = String(body.weekLabel || '').trim().slice(0, 40);
  if (body.startDate !== undefined) {
    if (!parseYmd(body.startDate)) {
      throw Object.assign(new Error('开始日期格式应为 YYYY-MM-DD'), { status: 400 });
    }
    c.startDate = String(body.startDate).trim();
  }
  if (body.endDate !== undefined) {
    if (!parseYmd(body.endDate)) {
      throw Object.assign(new Error('结束日期格式应为 YYYY-MM-DD'), { status: 400 });
    }
    c.endDate = String(body.endDate).trim();
  }
  if (body.hint !== undefined) c.hint = String(body.hint || '').trim().slice(0, 120);
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) {
      throw Object.assign(new Error('items 须为数组'), { status: 400 });
    }
    c.items = body.items.map((it, i) => normalizeItem(it, i)).sort((a, b) => a.sort - b.sort);
  }
  if (dayStartMs(c.startDate) > dayEndMs(c.endDate)) {
    throw Object.assign(new Error('开始日期不能晚于结束日期'), { status: 400 });
  }
  cfg.current = c;
  db.settings.weeklyActivities = cfg;
  return getWeeklyActivitiesAdmin(db, now);
}

/** 归档当前周，开启下一周空白档（可带默认条目） */
function archiveWeeklyActivities(db, body = {}, now = Date.now()) {
  const cfg = ensureWeeklyActivities(db, now);
  const old = cfg.current;
  cfg.history = [
    {
      weekLabel: old.weekLabel,
      startDate: old.startDate,
      endDate: old.endDate,
      hint: old.hint || '',
      items: (old.items || []).map((it, i) => normalizeItem(it, i)),
      archivedAt: now,
    },
    ...(cfg.history || []),
  ].slice(0, 40);

  const next = weekRangeOf(now);
  // 若当前周还没结束，下一档默认从明天起的下一完整周；否则用本周范围
  let startDate = body.startDate || next.startDate;
  let endDate = body.endDate || next.endDate;
  if (body.useNextWeek) {
    const end = dayEndMs(old.endDate) || now;
    const after = weekRangeOf(Math.max(now, end + 24 * 3600 * 1000));
    startDate = after.startDate;
    endDate = after.endDate;
  }
  const keepItems = body.keepItems === true;
  cfg.current = {
    weekLabel: String(body.weekLabel || `${startDate}～${endDate}`).trim(),
    startDate,
    endDate,
    hint: String(body.hint != null ? body.hint : '本周活动 · 会员免费参与').trim(),
    items: keepItems
      ? (old.items || []).map((it, i) => normalizeItem({ ...it, id: uid() }, i))
      : body.seedDefaults === false
        ? []
        : defaultWeekItems(),
  };
  db.settings.weeklyActivities = cfg;
  return getWeeklyActivitiesAdmin(db, now);
}

function claimedForPack(db, userId, pack, now) {
  if (!userId || !pack) return false;
  if (pack === 'fruit_retail_off') return hasFruitRetailOffToday(db, userId, now);
  if (pack === 'cane_promo') return hasCanePromoToday(db, userId, now);
  return false;
}

function presentWeeklyItem(it, { db, userId, now, weekWin }) {
  const claimed = claimedForPack(db, userId, it.claimPack, now);
  let status = 'offline';
  let statusText = '未开启';
  if (!it.enabled) {
    status = 'offline';
    statusText = '未开启';
  } else if (weekWin.ok) {
    status = 'active';
    statusText = claimed ? '领取过' : '进行中';
  } else if (weekWin.reason === 'not_started') {
    status = 'upcoming';
    statusText = '未开始';
  } else {
    status = 'expired';
    statusText = '已过期';
  }

  let action = it.action;
  let actionText = it.actionText;
  if (claimed && (action === 'claim' || !actionText)) {
    action = 'order';
    actionText = '去下单';
  } else if (!actionText) {
    if (action === 'claim') actionText = '去领取';
    else if (action === 'wallet') actionText = '去充值';
    else if (action === 'order') actionText = '去下单';
    else actionText = '查看';
  }
  if (status !== 'active') {
    if (status === 'expired') {
      action = claimed ? 'order' : 'none';
      actionText = claimed ? '去下单' : '已结束';
    } else if (status === 'upcoming') {
      action = 'none';
      actionText = '未开始';
    } else {
      action = 'none';
      actionText = '未开启';
    }
  }

  return {
    id: it.id,
    tag: it.tag,
    title: it.title,
    sub: it.sub,
    detail: it.detail,
    theme: it.theme || 'default',
    status,
    statusText,
    claimed,
    action,
    actionText,
    endDate: '',
    claimPack: it.claimPack || '',
    source: 'weekly',
  };
}

function listActivities(db, userId = null, now = Date.now()) {
  ensureWeeklyActivities(db, now);
  const weekly = getWeeklyActivitiesPublic(db, now);
  const weekWin = windowStatus(weekly.startDate, weekly.endDate, now);
  const cfg = db.settings.weeklyActivities;
  const items = [];

  // 常驻：会员
  const member = getMemberDiscountPublic(db);
  const loyalty = userId
    ? getLoyaltyState(db, { userId, includeCurrent: false, now })
    : null;
  const memberRules =
    (loyalty && loyalty.rules && loyalty.rules.length && loyalty.rules) ||
    (member.enabled
      ? [
          `充值即享全场 ${member.zheLabel || '9折'}，果切 / 果汁 / 零食通吃`,
          '周周线上活动免费参与，天天弹框领券不错过',
          '充值有礼，余额可整单付款；自定义称重同样享会员价',
          '立减券与会员折同单任选其一，系统自动算更省',
        ]
      : []);
  items.push({
    id: 'member_discount',
    tag: '会员福利',
    title: member.label || '会员专属权益',
    sub: member.enabled
      ? `全场 ${member.zheLabel || '9折'} · 周周活动免费参与 · 充值有礼`
      : '会员折扣未开启',
    status: member.enabled ? 'active' : 'offline',
    statusText: member.enabled ? '进行中' : '未开启',
    theme: 'member',
    action: 'wallet',
    actionText: loyalty && loyalty.isMember ? '去点单' : '去充值',
    detail: memberRules.join('；'),
    source: 'standing',
  });

  // 本周可配置活动
  const weekItems = (cfg.current.items || [])
    .filter((x) => x && x.enabled !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  for (const it of weekItems) {
    const row = presentWeeklyItem(it, { db, userId, now, weekWin });
    if (weekWin.ok) {
      row.endDate = weekly.endDate;
    } else if (weekWin.reason === 'expired') {
      row.endDate = weekly.endDate;
    }
    items.push(row);
  }

  // 充值有礼常驻
  try {
    const wallet = getWalletPublic(db);
    if (wallet && wallet.enabled) {
      const tiers = wallet.tiers || [];
      const tip = tiers
        .slice(0, 2)
        .map((t) => t.title || `充${t.payAmount}送${t.bonus}`)
        .join(' · ');
      items.push({
        id: 'wallet',
        tag: '储值',
        title: '充值有礼',
        sub: tip || '充值到账本金+赠金，余额可整单付',
        status: 'active',
        statusText: '进行中',
        theme: 'gold',
        action: 'wallet',
        actionText: '去充值',
        source: 'standing',
      });
    }
  } catch {
    /* ignore */
  }

  // 往期周归档 → 已过期
  for (const past of cfg.history || []) {
    for (const it of past.items || []) {
      if (!it || it.enabled === false) continue;
      items.push({
        id: `hist_${past.startDate}_${it.id}`,
        tag: it.tag || '往期',
        title: it.title,
        sub: it.sub || `${past.startDate}～${past.endDate}`,
        detail: it.detail || '',
        status: 'expired',
        statusText: '已过期',
        theme: 'muted',
        action: 'none',
        actionText: '已过期',
        endDate: past.endDate || '',
        source: 'history',
      });
    }
  }

  // 若本周已过期，本周条目已在 presentWeeklyItem 标成 expired，会进 expired 区

  // 新人礼 / 开业转盘：下线展示
  const welcome = campaignInfo(now);
  items.push({
    id: 'welcome',
    tag: '新人礼',
    title: welcome.title || '新人见面礼',
    sub: welcome.bannerSub || welcome.subtitle || '',
    status: welcome.status || 'expired',
    statusText: welcome.statusText || '已过期',
    theme: 'muted',
    action: 'none',
    actionText: '已过期',
    detail: (welcome.rules || []).join('；'),
    source: 'legacy',
  });

  try {
    ensureLottery(db);
    const lot = lotteryCampaign(db, userId);
    items.push({
      id: 'lottery',
      tag: '开业活动',
      title: lot.title || '开业抽奖',
      sub: lot.subtitle || '登录抽好礼',
      status: lot.enabled && lot.active ? 'active' : 'expired',
      statusText: lot.enabled && lot.active ? '进行中' : '已过期',
      theme: 'muted',
      action: 'none',
      actionText: lot.enabled && lot.active ? '去抽奖' : '已过期',
      source: 'legacy',
    });
  } catch {
    items.push({
      id: 'lottery',
      tag: '开业活动',
      title: '开业抽奖',
      sub: '登录抽好礼',
      status: 'expired',
      statusText: '已过期',
      theme: 'muted',
      action: 'none',
      actionText: '已过期',
      source: 'legacy',
    });
  }

  const popup = getPromoPopupPublic(db, userId, now);
  const active = items.filter((x) => x.status === 'active');
  const expired = items.filter((x) => x.status !== 'active');
  return {
    hint: weekly.hint || popup.hint || '',
    week: {
      label: weekly.weekLabel,
      startDate: weekly.startDate,
      endDate: weekly.endDate,
      status: weekly.status,
      statusText: weekly.statusText,
    },
    popup,
    memberDiscount: member,
    loyalty,
    active,
    expired,
    list: [...active, ...expired],
  };
}

module.exports = {
  listActivities,
  ensureWeeklyActivities,
  getWeeklyActivitiesPublic,
  getWeeklyActivitiesAdmin,
  updateWeeklyActivities,
  archiveWeeklyActivities,
  weekRangeOf,
};
