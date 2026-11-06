const { request, mediaUrl } = require('../../utils/api');
const cartUtil = require('../../utils/cart');

Page({
  data: {
    product: null,
    coverUrl: '',
    specId: '',
    extras: [],
    extraMap: {},
    quantity: 1,
    unitPrice: '0.00',
    promoHint: '',
    loyaltyHint: '',
    isRetail: false,
    isFruitBowl: false,
    toppings: [],
    toppingIds: [],
    toppingMap: {},
  },

  onLoad(query) {
    this.productId = query.id;
    this.load();
  },

  async load() {
    try {
      const p = await request(`/api/products/${this.productId}`);
      const specId = (p.specs && p.specs[0] && p.specs[0].id) || '';
      const isRetail = p.category === '水果零售' || p.category === '零售什锦';
      const isFruitBowl = p.category === '水果捞' || /水果捞|捞$/.test(String(p.name || ''));
      this.setData({
        product: p,
        coverUrl: mediaUrl(p.coverDetail || p.coverList || p.cover),
        specId,
        isRetail,
        isFruitBowl,
        toppings: [],
        toppingIds: [],
        toppingMap: {},
      });
      if (isFruitBowl) await this.loadToppings();
      await this.loadPromoHint();
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

  async loadPromoHint() {
    try {
      const promo = await request('/api/promo');
      this.setData({
        promoHint: promo.hint || '',
        loyaltyHint: (promo.loyalty && promo.loyalty.nextHint) || promo.loyaltyHint || '',
      });
    } catch {
      /* ignore */
    }
  },

  recalcPrice() {
    const { product, specId, extras, toppingIds, toppings } = this.data;
    if (!product || !specId) return;
    const spec = (product.specs || []).find((s) => s.id === specId);
    let unit = spec ? Number(spec.price) || 0 : 0;
    (product.extras || []).forEach((item) => {
      if ((extras || []).includes(item.id)) unit += Number(item.price) || 0;
    });
    (toppings || []).forEach((item) => {
      if ((toppingIds || []).includes(item.id)) unit += Number(item.price) || 0;
    });
    this.setData({ unitPrice: unit.toFixed(2) });
  },

  onSpec(e) {
    this.setData({ specId: e.currentTarget.dataset.id });
    this.recalcPrice();
  },

  onExtra(e) {
    const id = e.currentTarget.dataset.id;
    let extras = [...this.data.extras];
    const extraMap = { ...this.data.extraMap };
    if (extraMap[id]) {
      extras = extras.filter((x) => x !== id);
      delete extraMap[id];
    } else {
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
    const { product, specId, extras, toppingIds, toppings, quantity, unitPrice, coverUrl } =
      this.data;
    if (!product || !specId) {
      wx.showToast({ title: '请选择规格', icon: 'none' });
      return null;
    }
    const spec = (product.specs || []).find((s) => s.id === specId);
    const toppingNames = (toppings || [])
      .filter((t) => (toppingIds || []).includes(t.id))
      .map((t) => t.name);
    return {
      productId: product.id,
      productName: product.name,
      productCategory: product.category || '',
      cover: product.cover || '',
      coverUrl,
      specId,
      specName: (spec && spec.name) || '',
      extras: extras || [],
      toppingIds: toppingIds || [],
      toppingNames,
      quantity: Math.max(1, Number(quantity) || 1),
      unitPrice: Number(unitPrice) || 0,
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
