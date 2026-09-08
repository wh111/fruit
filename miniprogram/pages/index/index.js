const { request, mediaUrl, ensureLogin, consumeWelcomeToast, consumeMonthlyToast } = require('../../utils/api');

Page({
  data: {
    products: [],
    filtered: [],
    categories: ['全部'],
    activeCat: '全部',
    promoHint: '',
    loyaltyHint: '',
    campaign: null,
    couponUnused: 0,
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
      const loginRes = await ensureLogin().catch(() => null);
      // 若仍无 token（偶发失败），再强制登一次
      if (!wx.getStorageSync('token')) {
        await ensureLogin({ force: true }).catch(() => null);
      }
      const [productRes, promo, campaign] = await Promise.all([
        request('/api/products'),
        request('/api/promo').catch(() => ({})),
        request('/api/coupons/campaign').catch(() => null),
      ]);
      let couponUnused = 0;
      let justGranted = 0;
      let monthlyJust = 0;
      if (wx.getStorageSync('token')) {
        try {
          const mine = await request('/api/coupons/mine');
          couponUnused = (mine.summary && mine.summary.unused) || 0;
          wx.setStorageSync('couponSummary', mine.summary || {});
          if (mine.welcomeGranted) justGranted = mine.welcomeCouponCount || 21;
          if (mine.monthlyGranted) monthlyJust = mine.monthlyCouponCount || 3;
        } catch (e) {
          const msg = (e && e.message) || '';
          if (/请先登录|未登录|401/.test(msg)) {
            await ensureLogin({ force: true }).catch(() => null);
            try {
              const mine2 = await request('/api/coupons/mine');
              couponUnused = (mine2.summary && mine2.summary.unused) || 0;
              if (mine2.welcomeGranted) justGranted = mine2.welcomeCouponCount || 21;
              if (mine2.monthlyGranted) monthlyJust = mine2.monthlyCouponCount || 3;
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
      // ensureLogin 已发券时，用其返回补齐 toast 计数
      if (!justGranted && loginRes && loginRes.welcomeGranted) {
        justGranted = loginRes.welcomeCouponCount || 21;
      }
      if (!monthlyJust && loginRes && loginRes.monthlyGranted) {
        monthlyJust = loginRes.monthlyCouponCount || 3;
      }
      const products = productRes.list.map((p) => {
        const prices = (p.specs || []).map((s) => Number(s.price));
        const min = prices.length ? Math.min(...prices) : 0;
        return {
          ...p,
          coverUrl: mediaUrl(p.cover),
          minPrice: min ? min.toFixed(1) : '0',
        };
      });
      const catOrder = ['果切系列', '水果捞', '热果奶', '经典热饮'];
      const seen = new Set();
      const ordered = catOrder.filter((c) => {
        if (!products.some((p) => p.category === c)) return false;
        seen.add(c);
        return true;
      });
      products.forEach((p) => {
        if (p.category && !seen.has(p.category)) {
          seen.add(p.category);
          ordered.push(p.category);
        }
      });
      const cats = ['全部', ...ordered];
      const loyalty = promo.loyalty || {};
      let loyaltyHint = '';
      if (loyalty.label) {
        loyaltyHint = `${loyalty.label} · 可与立减券同享`;
      } else if (loyalty.nextHint) {
        loyaltyHint = `${loyalty.nextHint}；满10单升9折`;
      } else {
        loyaltyHint = '本月满3单95折、满10单9折，可与立减券同享';
      }
      this.setData({
        products,
        categories: cats,
        promoHint: promo.hint || '',
        loyaltyHint,
        campaign: campaign || null,
        couponUnused,
        loadError: '',
      });
      this.filter(this.data.activeCat);

      const welcome = consumeWelcomeToast();
      const monthly = consumeMonthlyToast();
      const grantedCount =
        justGranted ||
        (welcome && welcome.count) ||
        (loginRes && loginRes.welcomeGranted && loginRes.welcomeCouponCount) ||
        0;
      const monthlyCount =
        monthlyJust ||
        (monthly && monthly.count) ||
        (loginRes && loginRes.monthlyGranted && loginRes.monthlyCouponCount) ||
        0;

      if (grantedCount) {
        const reserveAmt =
          (campaign && campaign.reserveOffAmount) ||
          (loginRes && loginRes.campaign && loginRes.campaign.reserveOffAmount) ||
          3;
        wx.showModal({
          title: '新人券包已到账',
          content: `已放入 ${grantedCount} 张优惠券：满15减5×3、满25减8×3、预定立减${reserveAmt}×15，30天内有效。`,
          confirmText: monthlyCount ? '下一条' : '去看看',
          cancelText: '知道了',
          success: (r) => {
            if (monthlyCount) {
              wx.showModal({
                title: '本月登录礼已到账',
                content: `无门槛减3元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
                confirmText: '去看看',
                cancelText: '知道了',
                success: (r2) => {
                  if (r2.confirm) wx.navigateTo({ url: '/pages/coupons/coupons' });
                },
              });
            } else if (r.confirm) {
              wx.navigateTo({ url: '/pages/coupons/coupons' });
            }
          },
        });
      } else if (monthlyCount) {
        wx.showModal({
          title: '本月登录礼已到账',
          content: `无门槛减3元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
          confirmText: '去看看',
          cancelText: '知道了',
          success: (r) => {
            if (r.confirm) wx.navigateTo({ url: '/pages/coupons/coupons' });
          },
        });
      }
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

  async onBanner() {
    try {
      await ensureLogin();
      wx.navigateTo({ url: '/pages/coupons/coupons' });
    } catch (e) {
      wx.showToast({ title: e.message || '请先登录', icon: 'none' });
    }
  },
});
