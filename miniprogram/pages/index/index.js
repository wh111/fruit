const { request, mediaUrl, ensureLogin } = require('../../utils/api');

Page({
  data: {
    products: [],
    filtered: [],
    categories: ['全部'],
    activeCat: '全部',
    promoHint: '',
    promoOpen: false,
    loadError: '',
    debugApi: '',
    debugEnv: '',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    let debugEnv = '';
    try {
      debugEnv = wx.getAccountInfoSync().miniProgram.envVersion || '';
    } catch (_) {
      /* ignore */
    }
    const { config } = require('../../utils/api');
    this.setData({ debugApi: config.baseUrl, debugEnv });
    try {
      await ensureLogin().catch(() => null);
      const [productRes, promo] = await Promise.all([
        request('/api/products'),
        request('/api/promo').catch(() => ({})),
      ]);
      const promoOpen = !!(promo.lunchOpen || promo.eveningOpen);
      const products = productRes.list.map((p) => {
        const prices = (p.specs || []).map((s) => Number(s.price));
        const min = prices.length ? Math.min(...prices) : 0;
        return {
          ...p,
          coverUrl: mediaUrl(p.cover),
          minPrice: min ? min.toFixed(1) : '0',
          preorderPrice: promoOpen && min ? (min * 0.8).toFixed(1) : '',
        };
      });
      const cats = ['全部', ...new Set(products.map((p) => p.category))];
      this.setData({
        products,
        categories: cats,
        promoHint: promo.hint || '',
        promoOpen,
        loadError: '',
      });
      this.filter(this.data.activeCat);
    } catch (e) {
      const loadError = e.message || '加载失败';
      this.setData({ loadError, products: [], filtered: [] });
      wx.showModal({ title: '连不上后端', content: loadError, showCancel: false });
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
