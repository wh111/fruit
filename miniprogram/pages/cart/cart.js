const { mediaUrl, request, ensureLogin } = require('../../utils/api');
const cart = require('../../utils/cart');
const { formatPrice, memberFactorFromPromo, displayDeal } = require('../../utils/pricing');

function decorate(list, priceCtx) {
  return (list || []).map((it) => {
    const parts = [];
    if ((it.extraNames || []).length) parts.push((it.extraNames || []).join('、'));
    if ((it.toppingNames || []).length) parts.push((it.toppingNames || []).join('、'));
    const origin = Number(it.unitPrice) || 0;
    const deal = displayDeal(origin, {
      isMember: priceCtx.isMember,
      factor: priceCtx.factor,
      coupons: priceCtx.coupons,
      productId: it.productId,
      category: it.productCategory,
    });
    return {
      ...it,
      coverUrl: it.coverUrl || mediaUrl(it.cover),
      toppingText: parts.join(' · '),
      displayUnit: formatPrice(deal.sale),
      originUnit: deal.discounted ? formatPrice(deal.origin) : '',
      showStrike: !!deal.discounted,
      priceTag: deal.tag || '',
      lineSale: deal.sale * (Number(it.quantity) || 0),
      lineOrigin: deal.origin * (Number(it.quantity) || 0),
    };
  });
}

Page({
  data: {
    items: [],
    count: 0,
    estimate: '0.00',
    originEstimate: '',
    showStrike: false,
    isMember: false,
    memberFactor: 1,
    unusedCoupons: [],
    shopClosed: false,
    shopClosedMessage: '',
  },

  onShow() {
    this.boot();
  },

  async boot() {
    await this.loadPriceCtx();
    this.refresh();
  },

  async loadPriceCtx() {
    let promo = {};
    let unusedCoupons = [];
    try {
      await ensureLogin().catch(() => null);
      promo = await request('/api/promo').catch(() => ({}));
      if (wx.getStorageSync('token')) {
        const mine = await request('/api/coupons/mine').catch(() => null);
        unusedCoupons = ((mine && mine.list) || []).filter((c) => c && c.status === 'unused');
      }
    } catch {
      /* ignore */
    }
    const memberInfo = memberFactorFromPromo(promo);
    const shopOpen = (promo && promo.shopOpen) || {};
    const shopClosed = shopOpen.enabled !== false && shopOpen.isOpen === false;
    const shopClosedMessage =
      shopOpen.closedMessage ||
      `门店营业时间 ${shopOpen.label || '09:30–20:00'}，当前暂停下单`;
    this.setData({
      isMember: memberInfo.isMember,
      memberFactor: memberInfo.factor,
      unusedCoupons,
      shopClosed,
      shopClosedMessage,
    });
  },

  refresh() {
    const priceCtx = {
      isMember: this.data.isMember,
      factor: this.data.memberFactor,
      coupons: this.data.unusedCoupons,
    };
    const list = decorate(cart.readCart(), priceCtx);
    const count = cart.cartCount(list);
    const saleSum = list.reduce((s, it) => s + (Number(it.lineSale) || 0), 0);
    const originSum = list.reduce((s, it) => s + (Number(it.lineOrigin) || 0), 0);
    const showStrike = saleSum + 1e-9 < originSum;
    this.setData({
      items: list,
      count,
      estimate: formatPrice(saleSum),
      originEstimate: showStrike ? formatPrice(originSum) : '',
      showStrike,
    });
  },

  inc(e) {
    const i = Number(e.currentTarget.dataset.index);
    const cur = cart.readCart()[i];
    if (!cur) return;
    cart.setQty(i, (Number(cur.quantity) || 0) + 1);
    this.refresh();
  },

  dec(e) {
    const i = Number(e.currentTarget.dataset.index);
    const cur = cart.readCart()[i];
    if (!cur) return;
    cart.setQty(i, (Number(cur.quantity) || 0) - 1);
    this.refresh();
  },

  onRemove(e) {
    const i = Number(e.currentTarget.dataset.index);
    cart.removeAt(i);
    this.refresh();
  },

  goCheckout() {
    if (this.data.shopClosed) {
      wx.showToast({
        title: this.data.shopClosedMessage || '非营业时间，暂停下单',
        icon: 'none',
      });
      return;
    }
    const list = cart.readCart();
    if (!list.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' });
      return;
    }
    cart.setCheckoutItems(list, { fromCart: true });
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  },
});
