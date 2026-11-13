const {
  request,
  mediaUrl,
  ensureLogin,
  consumeWelcomeToast,
  consumeMonthlyToast,
  bindPhoneNumber,
} = require('../../utils/api');
const cartUtil = require('../../utils/cart');
const { enableShareMenu, homeShare } = require('../../utils/share');

const WHEEL_COLORS = ['#ef6c00', '#f9a825', '#43a047', '#fb8c00', '#66bb6a', '#e65100'];
const SPIN_MS = 4200;
/** 仅本次小程序启动内跳过自动弹窗（不要用 setStorageSync，否则会永久不弹） */
let lotterySkippedThisLaunch = false;

function buildWheel(prizes) {
  const list = prizes || [];
  const n = list.length || 1;
  const sector = 360 / n;
  const stops = list
    .map((p, i) => {
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      const from = (i * sector).toFixed(2);
      const to = ((i + 1) * sector).toFixed(2);
      return `${color} ${from}deg ${to}deg`;
    })
    .join(', ');
  const wheelLabels = list.map((p, i) => {
    const title = String(p.title || '奖品');
    return {
      id: p.id || `p${i}`,
      // 与 conic-gradient(from -sector/2) 对齐：第 i 扇区中心在 i*sector（正上方为 0）
      mid: i * sector,
      short: title.length > 6 ? `${title.slice(0, 5)}…` : title,
    };
  });
  return {
    wheelBg: `conic-gradient(from -${sector / 2}deg, ${stops})`,
    wheelLabels,
    sector,
  };
}

Page({
  data: {
    products: [],
    filtered: [],
    categories: [],
    activeCat: '',
    promoHint: '',
    loyaltyHint: '',
    campaign: null,
    couponUnused: 0,
    loadError: '',
    showPhoneAuth: false,
    hasPhone: false,
    showLottery: false,
    lotteryTitle: '开业抽奖',
    lotterySub: '点击转盘抽好礼',
    lotteryPrizes: [],
    lotteryCanDraw: false,
    lotteryCanAgain: false,
    lotterySpinning: false,
    lotteryResult: null,
    wheelBg: '',
    wheelLabels: [],
    wheelDeg: 0,
    wheelTransition: 'none',
    cartCount: 0,
    cartEstimate: '0.00',
  },

  _lotterySector: 72,
  _spinTimer: null,

  onShow() {
    enableShareMenu();
    this.refreshCartBar();
    this.load();
  },

  onShareAppMessage() {
    return homeShare();
  },

  onShareTimeline() {
    const share = homeShare();
    return { title: share.title };
  },

  refreshCartBar() {
    const list = cartUtil.readCart();
    this.setData({
      cartCount: cartUtil.cartCount(list),
      cartEstimate: cartUtil.cartEstimate(list).toFixed(2),
    });
  },

  goCart() {
    wx.navigateTo({ url: '/pages/cart/cart' });
  },

  goCheckout() {
    const list = cartUtil.readCart();
    if (!list.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' });
      return;
    }
    cartUtil.setCheckoutItems(list, { fromCart: true });
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async refreshPhoneState() {
    // 审核要求：进点单页可先浏览，不强制弹手机号授权
    try {
      const me = await request('/api/auth/me');
      if (me && me.user) {
        wx.setStorageSync('user', me.user);
        const hasPhone = !!(me.user.hasPhone || me.user.phone);
        this.setData({ hasPhone });
        return hasPhone;
      }
    } catch (_) {
      /* ignore */
    }
    const user = wx.getStorageSync('user') || {};
    const hasPhone = !!(user.hasPhone || user.phone);
    this.setData({ hasPhone });
    return hasPhone;
  },

  /** 用户主动操作时再弹出手机号快捷登录 */
  openPhoneAuth() {
    if (this.data.hasPhone) return false;
    this.setData({ showPhoneAuth: true });
    return true;
  },

  async load() {
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
          if (mine.welcomeGranted) justGranted = mine.welcomeCouponCount || 15;
          if (mine.monthlyGranted) monthlyJust = mine.monthlyCouponCount || 1;
        } catch (e) {
          const msg = (e && e.message) || '';
          if (/请先登录|未登录|401/.test(msg)) {
            await ensureLogin({ force: true }).catch(() => null);
            try {
              const mine2 = await request('/api/coupons/mine');
              couponUnused = (mine2.summary && mine2.summary.unused) || 0;
              if (mine2.welcomeGranted) justGranted = mine2.welcomeCouponCount || 15;
              if (mine2.monthlyGranted) monthlyJust = mine2.monthlyCouponCount || 1;
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
      if (!justGranted && loginRes && loginRes.welcomeGranted) {
        justGranted = loginRes.welcomeCouponCount || 15;
      }
      if (!monthlyJust && loginRes && loginRes.monthlyGranted) {
        monthlyJust = loginRes.monthlyCouponCount || 1;
      }
      const products = productRes.list.map((p) => {
        const prices = (p.specs || []).map((s) => Number(s.price));
        const min = prices.length ? Math.min(...prices) : 0;
        return {
          ...p,
          coverUrl: mediaUrl(p.coverList || p.cover),
          minPrice: min ? min.toFixed(1) : '0',
        };
      });
      const catOrder = ['果切系列', '水果零售', '水果捞', '热果奶', '经典热饮'];
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
      const cats = ordered;
      const loyalty = promo.loyalty || {};
      let loyaltyHint = '';
      if (loyalty.enabled && loyalty.label) {
        loyaltyHint = `${loyalty.label} · 可与立减券同享`;
      } else if (loyalty.enabled && loyalty.nextHint) {
        loyaltyHint = loyalty.nextHint;
      }
      const activeCat = cats.includes(this.data.activeCat) ? this.data.activeCat : cats[0] || '';
      this.setData({
        products,
        categories: cats,
        activeCat,
        promoHint: promo.hint || '',
        loyaltyHint,
        campaign: campaign || null,
        couponUnused,
        loadError: '',
      });
      this.filter(activeCat);

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

      const reserveAmt =
        (campaign && campaign.reserveOffAmount) ||
        (loginRes && loginRes.campaign && loginRes.campaign.reserveOffAmount) ||
        3;
      this._pendingAfterLottery = { grantedCount, monthlyCount, reserveAmt };

      this.maybeShowLottery().then((shown) => {
        if (!shown) this.runAfterLotteryQueue();
      });
    } catch (e) {
      console.warn('index load failed', e && e.message);
      const loadError = '加载失败，请下拉刷新重试';
      this.setData({ loadError, products: [], filtered: [] });
      wx.showToast({ title: loadError, icon: 'none' });
    }
  },

  filter(cat) {
    const filtered = this.data.products.filter((p) => p.category === cat);
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
      if (!this.data.hasPhone && this.openPhoneAuth()) return;
      wx.navigateTo({ url: '/pages/coupons/coupons' });
    } catch (e) {
      wx.showToast({ title: e.message || '请先登录', icon: 'none' });
    }
  },

  skipPhoneAuth() {
    wx.setStorageSync('sg_phone_skip_session', 1);
    this.setData({ showPhoneAuth: false });
  },

  async maybeShowLottery() {
    if (this.data.lotterySpinning) return true;
    try {
      // 清掉旧版「永久跳过」标记，避免点过一次「先去点单」后永远不弹
      try {
        wx.removeStorageSync('sg_lottery_skip_session');
      } catch (_) {
        /* ignore */
      }
      // 未登录时 canDraw 恒为 false；先确保登录再问能否抽
      if (!wx.getStorageSync('token')) {
        await ensureLogin({ force: true }).catch(() => null);
      }
      const data = await request('/api/lottery');
      const prizes = data.prizes || [];
      if (!prizes.length || !data.enabled || !data.active) return false;
      // 测试期 / 测试账号：每次进店都弹；正式用户：可抽才弹，且尊重本次启动内「先去点单」
      const popEvery = !!(data.popEveryVisit || data.testMode || data.testAccount);
      this._lotteryPopEvery = popEvery;
      if (!popEvery && lotterySkippedThisLaunch) return false;
      if (!data.canDraw && !popEvery) return false;
      const wheel = buildWheel(prizes);
      this._lotterySector = wheel.sector;
      this.setData({
        showLottery: true,
        showPhoneAuth: false,
        lotteryTitle: data.title || '开业抽奖',
        lotterySub: popEvery
          ? '测试账号 · 每次进店可抽'
          : data.subtitle || '扫码进店 · 点击转盘抽好礼',
        lotteryPrizes: prizes,
        lotteryCanDraw: !!data.canDraw || popEvery,
        lotteryCanAgain: popEvery,
        lotteryResult: null,
        lotterySpinning: false,
        wheelBg: wheel.wheelBg,
        wheelLabels: wheel.wheelLabels,
        wheelTransition: 'none',
      });
      return true;
    } catch (_) {
      return false;
    }
  },

  skipLottery() {
    // 正式用户：本次启动内不再弹；杀掉小程序重进仍会弹（未抽过时）
    if (!this._lotteryPopEvery) {
      lotterySkippedThisLaunch = true;
    }
    this.closeLottery();
  },

  runAfterLotteryQueue() {
    const pending = this._pendingAfterLottery || {};
    this._pendingAfterLottery = null;
    const grantedCount = pending.grantedCount || 0;
    const monthlyCount = pending.monthlyCount || 0;
    const reserveAmt = pending.reserveAmt || 3;
    const afterGrantModals = () => {
      /* 不自动索要手机号，避免审核判定「未体验即强制授权」 */
    };
    if (grantedCount) {
      wx.showModal({
        title: '预定立减券已到账',
        content: `已放入预定立减${reserveAmt}元 ×${grantedCount} 张，仅提前预定可用，30天内有效。`,
        confirmText: monthlyCount ? '下一条' : '去看看',
        cancelText: '知道了',
        success: (r) => {
          if (monthlyCount) {
            wx.showModal({
              title: '会员日甜蜜券已到账',
              content: `甜蜜迎周末！无门槛减1元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
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
        title: '会员日甜蜜券已到账',
        content: `甜蜜迎周末！无门槛减1元 ×${monthlyCount}，现取预定都能用，30天内有效。`,
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
  },

  closeLottery() {
    if (this._spinTimer) {
      clearTimeout(this._spinTimer);
      this._spinTimer = null;
    }
    const hadPending = !!this._pendingAfterLottery;
    this.setData({
      showLottery: false,
      lotterySpinning: false,
      lotteryResult: null,
      wheelTransition: 'none',
    });
    if (hadPending) this.runAfterLotteryQueue();
  },

  lotteryAgain() {
    this.setData({
      lotteryResult: null,
      lotterySpinning: false,
      wheelTransition: 'none',
    });
  },

  goLotteryCoupons() {
    this.closeLottery();
    wx.navigateTo({ url: '/pages/coupons/coupons' });
  },

  async onLotterySpin() {
    if (this.data.lotterySpinning || this.data.lotteryResult) return;
    if (!this.data.lotteryCanDraw && !this.data.lotteryCanAgain) {
      wx.showToast({ title: '暂不可抽奖', icon: 'none' });
      return;
    }
    this.setData({ lotterySpinning: true });
    try {
      await ensureLogin({ force: true });
      const data = await request('/api/lottery/draw', { method: 'POST' });
      const prize = (data && data.prize) || {};
      const prizes = this.data.lotteryPrizes || [];
      let idx = prizes.findIndex((p) => p.id === prize.id);
      if (idx < 0) idx = 0;
      const sector = this._lotterySector || 360 / Math.max(prizes.length, 1);
      // 指针在正上方；把第 idx 扇区中心转到指针下
      const want = (360 - ((idx * sector) % 360)) % 360;
      const rounds = 5 + Math.floor(Math.random() * 2);
      const current = Number(this.data.wheelDeg) || 0;
      const base = ((current % 360) + 360) % 360;
      const delta = rounds * 360 + ((want - base + 360) % 360);
      const nextDeg = current + delta;

      this.setData({
        wheelTransition: `transform ${SPIN_MS / 1000}s cubic-bezier(0.12, 0.75, 0.12, 1)`,
        wheelDeg: nextDeg,
        lotteryCanDraw: !!(data.campaign && data.campaign.canDraw),
        lotteryCanAgain: !!(data.campaign && data.campaign.testMode),
      });

      if (this._spinTimer) clearTimeout(this._spinTimer);
      this._spinTimer = setTimeout(() => {
        this._spinTimer = null;
        const qty = Math.max(1, Number((data && data.qty) || prize.qty || 1));
        this.setData({
          lotterySpinning: false,
          lotteryResult: { ...prize, qty },
        });
        if (prize.type !== 'none') {
          try {
            const summary = wx.getStorageSync('couponSummary') || {};
            summary.unused = (Number(summary.unused) || 0) + qty;
            wx.setStorageSync('couponSummary', summary);
            this.setData({ couponUnused: summary.unused });
          } catch (_) {
            /* ignore */
          }
        }
      }, SPIN_MS + 80);
    } catch (e) {
      this.setData({ lotterySpinning: false });
      wx.showToast({ title: (e && e.message) || '抽奖失败', icon: 'none' });
    }
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
            : '登录成功',
        icon: data.devMock ? 'none' : 'success',
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' });
    }
  },
});
