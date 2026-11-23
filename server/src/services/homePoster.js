/**
 * 小程序首页活动海报（后台可配置，发版后换活动无需再改小程序）
 */
const LINK_TYPES = new Set(['coupons', 'product', 'category', 'none']);
const THEMES = new Set(['default', 'winter', 'warm']);

function defaultHomePoster() {
  return {
    enabled: false,
    tag: '活动',
    title: '',
    sub: '',
    btnText: '去看看',
    linkType: 'coupons',
    productId: '',
    category: '',
    imageUrl: '',
    theme: 'default',
  };
}

function ensureHomePoster(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.homePoster;
  if (!cur || typeof cur !== 'object') {
    db.settings.homePoster = defaultHomePoster();
  } else {
    const d = defaultHomePoster();
    db.settings.homePoster = {
      enabled: !!cur.enabled,
      tag: String(cur.tag != null ? cur.tag : d.tag).trim() || d.tag,
      title: String(cur.title || '').trim(),
      sub: String(cur.sub || '').trim(),
      btnText: String(cur.btnText != null ? cur.btnText : d.btnText).trim() || d.btnText,
      linkType: LINK_TYPES.has(cur.linkType) ? cur.linkType : d.linkType,
      productId: String(cur.productId || '').trim(),
      category: String(cur.category || '').trim(),
      imageUrl: String(cur.imageUrl || '').trim(),
      theme: THEMES.has(cur.theme) ? cur.theme : d.theme,
    };
  }
  return db.settings.homePoster;
}

function getConfig(db) {
  return { ...ensureHomePoster(db) };
}

/** 小程序公开字段：未开启或无标题时返回 null */
function publicConfig(db) {
  const cfg = ensureHomePoster(db);
  if (!cfg.enabled) return null;
  const title = String(cfg.title || '').trim();
  if (!title) return null;
  return {
    enabled: true,
    tag: cfg.tag || '活动',
    title,
    sub: cfg.sub || '',
    btnText: cfg.btnText || '去看看',
    linkType: cfg.linkType || 'coupons',
    productId: cfg.productId || '',
    category: cfg.category || '',
    imageUrl: cfg.imageUrl || '',
    theme: cfg.theme || 'default',
  };
}

function updateConfig(db, body = {}) {
  const cfg = ensureHomePoster(db);
  if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
  if (body.tag !== undefined) cfg.tag = String(body.tag || '').trim() || '活动';
  if (body.title !== undefined) cfg.title = String(body.title || '').trim();
  if (body.sub !== undefined) cfg.sub = String(body.sub || '').trim();
  if (body.btnText !== undefined) {
    cfg.btnText = String(body.btnText || '').trim() || '去看看';
  }
  if (body.linkType !== undefined) {
    cfg.linkType = LINK_TYPES.has(body.linkType) ? body.linkType : 'coupons';
  }
  if (body.productId !== undefined) cfg.productId = String(body.productId || '').trim();
  if (body.category !== undefined) cfg.category = String(body.category || '').trim();
  if (body.imageUrl !== undefined) cfg.imageUrl = String(body.imageUrl || '').trim();
  if (body.theme !== undefined) {
    cfg.theme = THEMES.has(body.theme) ? body.theme : 'default';
  }
  if (cfg.enabled && !cfg.title) {
    throw Object.assign(new Error('开启海报请填写标题'), { status: 400 });
  }
  if (cfg.linkType === 'product' && cfg.enabled && !cfg.productId) {
    throw Object.assign(new Error('跳转商品时请选择商品'), { status: 400 });
  }
  if (cfg.linkType === 'category' && cfg.enabled && !cfg.category) {
    throw Object.assign(new Error('跳转分类时请填写分类名'), { status: 400 });
  }
  db.settings.homePoster = cfg;
  return getConfig(db);
}

module.exports = {
  ensureHomePoster,
  getConfig,
  publicConfig,
  updateConfig,
  defaultHomePoster,
};
