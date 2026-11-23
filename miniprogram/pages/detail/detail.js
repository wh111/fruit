const { request, mediaUrl, ensureLogin } = require('../../utils/api');
const cartUtil = require('../../utils/cart');
const { enableShareMenu, productShare } = require('../../utils/share');
const { formatPrice, memberFactorFromPromo, displayDeal } = require('../../utils/pricing');

Page({
  data: {
    product: null,
    coverUrl: '',
    specId: '',
    extras: [],
    extraMap: {},
    extraPick: 0,
    quantity: 1,
    originUnitPrice: '0.00',
    unitPrice: '0.00',
    showStrike: false,
    priceTag: '',
    priceTip: '',
    promoHint: '',
    loyaltyHint: '',
    isMember: false,
    memberFactor: 1,
    unusedCoupons: [],
    isRetail: false,
    isFruitBowl: false,
    toppings: [],
    toppingIds: [],
    toppingMap: {},
    specViews: [],
  },

  onLoad(query) {
    this.productId = query.id;
    enableShareMenu();
    this.load();
  },

  onShareAppMessage() {
    return productShare(this.data.product, this.data.coverUrl);
  },

  onShareTimeline() {
    const share = productShare(this.data.product, this.data.coverUrl);
    return {
      title: share.title,
      query: this.data.product && this.data.product.id ? `id=${this.data.product.id}` : '',
      imageUrl: share.imageUrl || '',
    };
  },

  async load() {
    try {
      await ensureLogin().catch(() => null);
      const p = await request(`/api/products/${this.productId}`);
      const specId = (p.specs && p.specs[0] && p.specs[0].id) || '';
      const isRetail = p.category === '免洗什锦' || p.category === '水果零售' || p.category === '零售什锦';
      const isFruitBowl = p.category === '水果捞' || p.category === '酸奶捞' || /水果捞|捞$/.test(String(p.name || ''));
      const extraPick = Math.max(0, Number(p.extraPick) || 0);
      this.setData({
        product: p,
        coverUrl: mediaUrl(p.coverDetail || p.coverList || p.cover),
        specId,
        isRetail,
        isFruitBowl,
        extraPick,
        extras: [],
        extraMap: {},
        toppings: [],
        toppingIds: [],
        toppingMap: {},
      });
      if (isFruitBowl) await this.loadToppings();
      await this.loadPromoAndCoupons();
      this.recalcPrice();
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  async loadToppings() {
    try {
      const data = await request('/api/toppings');
      this.setData({ toppings: Array.isArray(data.list) ? data.list : [] });
    } catch {
      this.setData({ toppings: [] });
    }
  },

  async loadPromoAndCoupons() {
    let promo = {};
    let unusedCoupons = [];
    try {
      promo = await request('/api/promo');
    } catch {
      /* ignore */
    }
    try {
      if (wx.getStorageSync('token')) {
        const mine = await request('/api/coupons/mine');
        unusedCoupons = (mine.list || []).filter((c) => c && c.status === 'unused');
      }
    } catch {
      /* ignore */
    }
    const memberInfo = memberFactorFromPromo(promo);
    const loyalty = promo.loyalty || {};
    let loyaltyHint = '';
    if (memberInfo.isMember && memberInfo.label) {
      loyaltyHint = `${memberInfo.label}已生效，下方已显示优惠价`;
    } else if (loyalty.nextHint) {
      loyaltyHint = loyalty.nextHint;
    }
    this.setData({
      promoHint: '',
      loyaltyHint,
      isMember: memberInfo.isMember,
      memberFactor: memberInfo.factor,
      unusedCoupons,
    });
  },

  buildSpecViews() {
    const { product, isMember, memberFactor, unusedCoupons } = this.data;
    if (!product) return [];
    return (product.specs || []).map((s) => {
      const origin = Number(s.price) || 0;
      const deal = displayDeal(origin, {
        isMember,
        factor: memberFactor,
        coupons: unusedCoupons,
        productId: product.id,
        category: product.category,
      });
      return {
        ...s,
        displayPrice: formatPrice(deal.sale),
        originPrice: deal.discounted ? formatPrice(deal.origin) : '',
        showStrike: !!deal.discounted,
      };
    });
  },

  extrasAddAmount() {
    const { product, extras, toppingIds, toppings } = this.data;
    let add = 0;
    (product.extras || []).forEach((item) => {
      if ((extras || []).includes(item.id)) add += Number(item.price) || 0;
    });
    (toppings || []).forEach((item) => {
      if ((toppingIds || []).includes(item.id)) add += Number(item.price) || 0;
    });
    return add;
  },

  recalcPrice() {
    const { product, specId, isMember, memberFactor, unusedCoupons } = this.data;
    if (!product || !specId) return;
    const spec = (product.specs || []).find((s) => s.id === specId);
    let unit = spec ? Number(spec.price) || 0 : 0;
    unit += this.extrasAddAmount();
    const deal = displayDeal(unit, {
      isMember,
      factor: memberFactor,
      coupons: unusedCoupons,
      productId: product.id,
      category: product.category,
    });
    this.setData({
      originUnitPrice: formatPrice(deal.origin),
      unitPrice: formatPrice(deal.sale),
      showStrike: !!deal.discounted,
      priceTag: deal.tag || '',
      priceTip: deal.tip || '',
      listUnitPrice: deal.origin,
      specViews: this.buildSpecViews(),
    });
  },

  onSpec(e) {
    this.setData({ specId: e.currentTarget.dataset.id });
    this.recalcPrice();
  },

  onExtra(e) {
    const id = e.currentTarget.dataset.id;
    let extras = [...this.data.extras];
    const extraMap = { ...this.data.extraMap };
    const need = Math.max(0, Number(this.data.extraPick) || 0);
    if (extraMap[id]) {
      extras = extras.filter((x) => x !== id);
      delete extraMap[id];
    } else {
      if (need > 0 && extras.length >= need) {
        wx.showToast({ title: `最多选 ${need} 种`, icon: 'none' });
        return;
      }
      extras.push(id);
      extraMap[id] = true;
    }
    this.setData({ extras, extraMap });
    this.recalcPrice();
  },

  onTopping(e) {
    const id = e.currentTarget.dataset.id;
    let toppingIds = [...this.data.toppingIds];
    const toppingMap = { ...this.data.toppingMap };
    if (toppingMap[id]) {
      toppingIds = toppingIds.filter((x) => x !== id);
      delete toppingMap[id];
    } else {
      toppingIds.push(id);
      toppingMap[id] = true;
    }
    this.setData({ toppingIds, toppingMap });
    this.recalcPrice();
  },

  inc() {
    this.setData({ quantity: this.data.quantity + 1 });
  },

  dec() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
  },

  buildLine() {
    const {
      product,
      specId,
      extras,
      extraPick,
      toppingIds,
      toppings,
      quantity,
      listUnitPrice,
      coverUrl,
    } = this.data;
    if (!product || !specId) {
      wx.showToast({ title: '请选择规格', icon: 'none' });
      return null;
    }
    const need = Math.max(0, Number(extraPick) || 0);
    if (need > 0 && (extras || []).length !== need) {
      wx.showToast({ title: `请自选 ${need} 种水果`, icon: 'none' });
      return null;
    }
    const spec = (product.specs || []).find((s) => s.id === specId);
    const extraNames = (product.extras || [])
      .filter((ex) => (extras || []).includes(ex.id))
      .map((ex) => ex.name);
    const toppingNames = (toppings || [])
      .filter((t) => (toppingIds || []).includes(t.id))
      .map((t) => t.name);
    // 购物车存原价，结算由服务端重算会员折/券
    const originUnit = Number(listUnitPrice);
    return {
      productId: product.id,
      productName: product.name,
      productCategory: product.category || '',
      cover: product.cover || '',
      coverUrl,
      specId,
      specName: (spec && spec.name) || '',
      extras: extras || [],
      extraNames,
      toppingIds: toppingIds || [],
      toppingNames,
      quantity: Math.max(1, Number(quantity) || 1),
      unitPrice: Number.isFinite(originUnit) ? originUnit : Number(spec && spec.price) || 0,
    };
  },

  addCart() {
    const line = this.buildLine();
    if (!line) return;
    cartUtil.addToCart(line);
    wx.showToast({ title: '已加入购物车', icon: 'success' });
  },

  buyNow() {
    const line = this.buildLine();
    if (!line) return;
    cartUtil.setCheckoutItems([line], { fromCart: false });
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  },
});
