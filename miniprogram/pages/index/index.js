const {
  request,
  mediaUrl,
  ensureLogin,
  consumeWelcomeToast,
  consumeMonthlyToast,
  bindPhoneNumber,
} = require('../../utils/api');

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
    showPhoneAuth: false,
    hasPhone: false,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async refreshPhoneState() {
    try {
      const me = await request('/api/auth/me');
      if (me && me.user) {
        wx.setStorageSync('user', me.user);
        const hasPhone = !!(me.user.hasPhone || me.user.phone);
        this.setData({ hasPhone, showPhoneAuth: !hasPhone });
        return hasPhone;
      }
    } catch (_) {
      /* ignore */
    }
    const user = wx.getStorageSync('user') || {};
    const hasPhone = !!(user.hasPhone || user.phone);
    const skipped = !!wx.getStorageSync('sg_phone_skip_session');
    this.setData({ hasPhone, showPhoneAuth: !hasPhone && !skipped });
    return hasPhone;
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
      if (!wx.getStorageSync('token')) {
        await ensureLogin({ force: true }).catch(() => null);
      }
      await this.refreshPhoneState();
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
      if (loyalty.enabled && loyalty.label) {
        loyaltyHint = `${loyalty.label} · 可与立减券同享`;
      } else if (loyalty.enabled && loyalty.nextHint) {
        loyaltyHint = loyalty.nextHint;
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

      const afterGrantModals = () => {
        if (!this.data.hasPhone && !wx.getStorageSync('sg_phone_skip_session')) {
          this.setData({ showPhoneAuth: true });
        }
      };

      if (grantedCount) {
        const reserveAmt =
          (campaign && campaign.reserveOffAmount) ||
          (loginRes && loginRes.campaign && loginRes.campaign.reserveOffAmount) ||
          3;
        wx.showModal({
          title: '新人券包已到账',
          content: `已放入 ${grantedCount} 张优惠券：满15减3×3、预定立减${reserveAmt}×15，30天内有效。`,
          confirmText: monthlyCount ? '下一条' : '去看看',
          cancelText: '知道了',
          success: (r) => {
            if (monthlyCount) {
              wx.showModal({
                title: '本月登录礼已到账',
                content: `无门槛减2元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
                confirmText: '去看看',
                cancelText: '知道了',
                success: (r2) => {
                  if (r2.confirm) wx.navigateTo({ url: '/pages/coupons/coupons' });
                  afterGrantModals();
                },
              });
            } else {
              if (r.confirm) wx.navigateTo({ url: '/pages/coupons/coupons' });
              afterGrantModals();
            }
          },
        });
      } else if (monthlyCount) {
        wx.showModal({
          title: '本月登录礼已到账',
          content: `无门槛减2元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
          confirmText: '去看看',
          cancelText: '知道了',
          success: (r) => {
            if (r.confirm) wx.navigateTo({ url: '/pages/coupons/coupons' });
            afterGrantModals();
          },
        });
      } else {
        afterGrantModals();
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

  goBulk() {
    wx.navigateTo({ url: '/pages/bulk/bulk' });
  },

  async onBanner() {
    try {
      await ensureLogin();
      wx.navigateTo({ url: '/pages/coupons/coupons' });
    } catch (e) {
      wx.showToast({ title: e.message || '请先登录', icon: 'none' });
    }
  },

  skipPhoneAuth() {
    wx.setStorageSync('sg_phone_skip_session', 1);
    this.setData({ showPhoneAuth: false });
  },

  async onGetPhone(e) {
    try {
      wx.showLoading({ title: '绑定中' });
      await ensureLogin();
      const data = await bindPhoneNumber(e.detail || {});
      wx.hideLoading();
      wx.removeStorageSync('sg_phone_skip_session');
      this.setData({
        hasPhone: true,
        showPhoneAuth: false,
      });
      wx.showToast({
        title: data.devMock
          ? '开发环境已绑测试号'
          : data.merged
            ? '已同步到原账号'
            : '绑定成功',
        icon: data.devMock ? 'none' : 'success',
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '授权失败', icon: 'none' });
    }
  },
});
