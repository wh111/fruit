const { mediaUrl } = require('../../utils/api');
const cart = require('../../utils/cart');

function decorate(list) {
  return (list || []).map((it) => {
    const parts = [];
    if ((it.extraNames || []).length) parts.push((it.extraNames || []).join('、'));
    if ((it.toppingNames || []).length) parts.push((it.toppingNames || []).join('、'));
    return {
      ...it,
      coverUrl: it.coverUrl || mediaUrl(it.cover),
      toppingText: parts.join(' · '),
    };
  });
}

Page({
  data: {
    items: [],
    count: 0,
    estimate: '0.00',
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const list = decorate(cart.readCart());
    this.setData({
      items: list,
      count: cart.cartCount(list),
      estimate: cart.cartEstimate(list).toFixed(2),
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
    const list = cart.readCart();
    if (!list.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' });
      return;
    }
    cart.setCheckoutItems(list, { fromCart: true });
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  },
});
