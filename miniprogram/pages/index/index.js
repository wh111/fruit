const { request, mediaUrl, ensureLogin } = require('../../utils/api');

Page({
  data: {
    products: [],
    filtered: [],
    categories: ['全部'],
    activeCat: '全部',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      await ensureLogin().catch(() => null);
      const { list } = await request('/api/products');
      const products = list.map((p) => {
        const prices = (p.specs || []).map((s) => Number(s.price));
        return {
          ...p,
          coverUrl: mediaUrl(p.cover),
          minPrice: prices.length ? Math.min(...prices).toFixed(1) : '0',
        };
      });
      const cats = ['全部', ...new Set(products.map((p) => p.category))];
      this.setData({ products, categories: cats });
      this.filter(this.data.activeCat);
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  filter(cat) {
    const filtered =
      cat === '全部' ? this.data.products : this.data.products.filter((p) => p.category === cat);
    this.setData({ activeCat: cat, filtered });
  },

  onCat(e) {
    this.filter(e.currentTarget.dataset.cat);
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },
});
