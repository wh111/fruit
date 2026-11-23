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
const { formatPrice, memberFactorFromPromo, displayDeal } = require('../../utils/pricing');

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
    homePoster: null,
    showHomePoster: false,
    homePosterThemeClass: '',
    homePosterTag: '',
    homePosterTitle: '',
    homePosterSub: '',
    homePosterBtnText: '',
    homePosterImageUrl: '',
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
    cartOriginEstimate: '',
    cartShowStrike: false,
    walletEnabled: false,
    walletHint: '',
    isMember: false,
    memberFactor: 1,
    unusedCoupons: [],
    memberCardTitle: '会员专属权益',
    memberCardSub: '充值开通，点单更省、活动不错过',
    memberPerks: [
      '全场 9 折：果切、果汁、零食与自定义称重都能用',
      '周周线上活动免费参与，弹框领券不错过',
      '充值有礼，余额可整单付款',
    ],
    promoFoldOpen: false,
    promoFoldCount: 0,
    promoFoldSummary: '',
    showPromoPop: false,
    promoPopItems: [],
    promoPopHint: '',
    promoPopDailyLimit: 20,
    promoPopFreeLeft: 0,
    promoPopVip: false,
    promoClaimingPack: '',
  },

  _lotterySector: 72,
  _spinTimer: null,
  _promoPopSkippedThisLaunch: false,

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
    const count = cartUtil.cartCount(list);
    const origin = cartUtil.cartEstimate(list);
    // 购物车多品时按会员折估（单品券在详情/结算再算）
    const memberDeal = displayDeal(origin, {
      isMember: this.data.isMember,
      factor: this.data.memberFactor,
      coupons: [],
      productId: '',
      category: '',
    });
    this.setData({
      cartCount: count,
      cartEstimate: formatPrice(memberDeal.sale),
      cartOriginEstimate: memberDeal.discounted ? formatPrice(memberDeal.origin) : '',
      cartShowStrike: !!memberDeal.discounted,
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
      const [productRes, promo, wallet] = await Promise.all([
        request('/api/products'),
        request('/api/promo').catch(() => ({})),
        request('/api/wallet/mine').catch(() => null),
      ]);
      const campaign = null;
      const walletTiers = (wallet && wallet.tiers) || [];
      const walletEnabled = !!(wallet && wallet.enabled && walletTiers.length);
      let walletHint = '';
      if (walletEnabled) {
        // 首页固定展示入门档文案「充100送5」
        const entry =
          walletTiers.find((t) => Number(t.payAmount) === 100) ||
          walletTiers.reduce((a, b) =>
            Number(b.payAmount || 0) < Number(a.payAmount || 0) ? b : a
          );
        const pay = Math.round(Number(entry.payAmount) || 0);
        const bonus = Math.round(Number(entry.bonus) || 0);
        walletHint = `充${pay}送${bonus}`;
      }
      let couponUnused = 0;
      let justGranted = 0;
      let monthlyJust = 0;
      let unusedCoupons = [];
      if (wx.getStorageSync('token')) {
        try {
          const mine = await request('/api/coupons/mine');
          couponUnused = (mine.summary && mine.summary.unused) || 0;
          unusedCoupons = (mine.list || []).filter((c) => c && c.status === 'unused');
          wx.setStorageSync('couponSummary', mine.summary || {});
          if (mine.welcomeGranted) justGranted = mine.welcomeCouponCount || 5;
          if (mine.monthlyGranted) monthlyJust = mine.monthlyCouponCount || 1;
        } catch (e) {
          const msg = (e && e.message) || '';
          if (/请先登录|未登录|401/.test(msg)) {
            await ensureLogin({ force: true }).catch(() => null);
            try {
              const mine2 = await request('/api/coupons/mine');
              couponUnused = (mine2.summary && mine2.summary.unused) || 0;
              unusedCoupons = (mine2.list || []).filter((c) => c && c.status === 'unused');
              if (mine2.welcomeGranted) justGranted = mine2.welcomeCouponCount || 5;
              if (mine2.monthlyGranted) monthlyJust = mine2.monthlyCouponCount || 1;
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
      if (!justGranted && loginRes && loginRes.welcomeGranted) {
        justGranted = loginRes.welcomeCouponCount || 5;
      }
      if (!monthlyJust && loginRes && loginRes.monthlyGranted) {
        monthlyJust = loginRes.monthlyCouponCount || 1;
      }
      const memberInfo = memberFactorFromPromo(promo);
      const isMember = memberInfo.isMember;
      const memberFactor = memberInfo.factor;
      const priceCtx = { isMember, factor: memberFactor, coupons: unusedCoupons };
      const products = productRes.list.map((p) => {
        const prices = (p.specs || []).map((s) => Number(s.price));
        const min = prices.length ? Math.min(...prices) : 0;
        const deal = displayDeal(min, {
          ...priceCtx,
          productId: p.id,
          category: p.category,
        });
        return {
          ...p,
          coverUrl: mediaUrl(p.coverList || p.cover),
          minPrice: formatPrice(deal.sale),
          originPrice: deal.discounted ? formatPrice(deal.origin) : '',
          showStrike: !!deal.discounted,
          priceTag: deal.tag || '',
          weighed: p.category === '称重水果',
        };
      });
      const catOrder = ['酸奶捞', '网红小吃', '新鲜现剥', '果切系列', '免洗什锦', '水果捞', '热果奶', '经典热饮', '鲜榨果汁'];
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
      const memberDiscount = promo.memberDiscount || {};
      const zheLabel =
        (memberDiscount && memberDiscount.zheLabel) ||
        (loyalty.label && /折/.test(loyalty.label) ? loyalty.label.replace(/^会员/, '') : '') ||
        '9折';
      const memberCardTitle = isMember
        ? loyalty.label || `会员全场${zheLabel}`
        : `会员全场${zheLabel}`;
      const memberCardSub = isMember
        ? '您已开通会员，点单自动享折，周周活动可免费参与'
        : '充值开通会员：全场折扣 · 周周活动免费参与 · 充值有礼';
      const memberPerks =
        loyalty.rules && loyalty.rules.length
          ? loyalty.rules
          : [
              `全场 ${zheLabel}：果切、果汁、零食与自定义称重都能用`,
              '周周线上活动免费参与，弹框领券不错过',
              '充值有礼，余额可整单付款',
              '立减券与会员折同单任选其一，自动取更省',
            ];
      const loyaltyHint = '';
      const homePosterRaw = promo && promo.homePoster;
      let homePoster = null;
      let showHomePoster = false;
      let homePosterThemeClass = '';
      let homePosterTag = '';
      let homePosterTitle = '';
      let homePosterSub = '';
      let homePosterBtnText = '';
      let homePosterImageUrl = '';
      if (homePosterRaw && homePosterRaw.enabled && homePosterRaw.title) {
        const theme =
          homePosterRaw.theme === 'winter' || homePosterRaw.theme === 'warm'
            ? homePosterRaw.theme
            : 'default';
        homePoster = {
          enabled: true,
          tag: homePosterRaw.tag || '活动',
          title: homePosterRaw.title,
          sub: homePosterRaw.sub || '',
          btnText: homePosterRaw.btnText || '去看看',
          linkType: homePosterRaw.linkType || 'coupons',
          productId: homePosterRaw.productId || '',
          category: homePosterRaw.category || '',
          theme,
          imageUrl: homePosterRaw.imageUrl ? mediaUrl(homePosterRaw.imageUrl) : '',
        };
        showHomePoster = true;
        homePosterThemeClass = 'theme-' + theme;
        homePosterTag = homePoster.tag;
        homePosterTitle = homePoster.title;
        homePosterSub = homePoster.sub;
        homePosterBtnText = homePoster.btnText;
        homePosterImageUrl = homePoster.imageUrl;
      }
      const nextCat = cats.includes(this.data.activeCat) ? this.data.activeCat : cats[0] || '';
      this.setData({
        products,
        categories: cats,
        activeCat: nextCat,
        promoHint: '',
        loyaltyHint,
        campaign: null,
        homePoster,
        showHomePoster: false,
        homePosterThemeClass,
        homePosterTag,
        homePosterTitle,
        homePosterSub,
        homePosterBtnText,
        homePosterImageUrl,
        couponUnused,
        walletEnabled,
        walletHint,
        isMember,
        memberFactor,
        unusedCoupons,
        memberCardTitle,
        memberCardSub,
        memberPerks,
        promoFoldCount: 0,
        promoFoldSummary: '',
        loadError: '',
      });
      this.filter(nextCat);
      this.refreshCartBar();

      // 新人礼已下线，不再弹「预定立减券已到账」
      consumeWelcomeToast();
      const monthly = consumeMonthlyToast();
      const monthlyCount =
        monthlyJust ||
        (monthly && monthly.count) ||
        (loginRes && loginRes.monthlyGranted && loginRes.monthlyCouponCount) ||
        0;
      this._pendingAfterLottery = { grantedCount: 0, monthlyCount, reserveAmt: 0 };

      // 开业转盘已下线，常态化弹框领券
      this.maybeShowPromoPop().then((promoShown) => {
        if (!promoShown) this.runAfterLotteryQueue();
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
    this._userPickedCat = true;
    this.filter(e.currentTarget.dataset.cat);
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  goBulk() {
    wx.navigateTo({ url: '/pages/bulk/bulk' });
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/wallet' });
  },

  togglePromoFold() {
    this.setData({ promoFoldOpen: !this.data.promoFoldOpen });
  },

  async onHomePoster() {
    const poster = this.data.homePoster;
    if (!poster) return;
    const linkType = poster.linkType || 'coupons';
    if (linkType === 'none') return;
    if (linkType === 'category') {
      const cat = poster.category;
      if (cat && (this.data.categories || []).includes(cat)) {
        this._userPickedCat = true;
        this.filter(cat);
        wx.showToast({ title: `已切到${cat}`, icon: 'none' });
      } else {
        wx.showToast({ title: '分类暂不可用', icon: 'none' });
      }
      return;
    }
    if (linkType === 'product') {
      if (!poster.productId) {
        wx.showToast({ title: '未配置商品', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: `/pages/detail/detail?id=${poster.productId}` });
      return;
    }
    try {
      await ensureLogin();
      if (!this.data.hasPhone && this.openPhoneAuth()) return;
      wx.navigateTo({ url: '/pages/coupons/coupons' });
    } catch (e) {
      wx.showToast({ title: e.message || '请先登录', icon: 'none' });
    }
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

  applyPromoPopup(data) {
    if (!data || !data.enabled || !(data.items || []).length) {
      this.setData({
        showPromoPop: false,
        promoPopItems: [],
        promoPopHint: '',
        promoPopFreeLeft: 0,
      });
      return false;
    }
    this.setData({
      promoPopItems: data.items || [],
      promoPopHint: data.hint || '',
      promoPopDailyLimit: data.dailyFreeLimit || 20,
      promoPopFreeLeft: data.freeLeft != null ? data.freeLeft : 0,
      promoPopVip: !!data.vip,
    });
    return !!(data.claimable);
  },

  async maybeShowPromoPop() {
    if (this.data.showLottery || this._promoPopSkippedThisLaunch) return false;
    try {
      if (!wx.getStorageSync('token')) {
        await ensureLogin({ force: true }).catch(() => null);
      }
      const data = await request('/api/coupons/promo-popup');
      const claimable = this.applyPromoPopup(data);
      if (!claimable) return false;
      this.setData({ showPromoPop: true, showPhoneAuth: false });
      return true;
    } catch (_) {
      return false;
    }
  },

  closePromoPop() {
    this._promoPopSkippedThisLaunch = true;
    this.setData({ showPromoPop: false, promoClaimingPack: '' });
    this.runAfterLotteryQueue();
  },

  onPromoGoOrder() {
    this.closePromoPop();
  },

  async onClaimPromo(e) {
    const pack = e.currentTarget.dataset.pack;
    if (!pack || this.data.promoClaimingPack) return;
    try {
      this.setData({ promoClaimingPack: pack });
      await ensureLogin({ force: true });
      const res = await request('/api/coupons/promo-claim', {
        method: 'POST',
        data: { pack },
      });
      if (res && res.popup) this.applyPromoPopup(res.popup);
      const unused = Number(this.data.couponUnused || 0) + 1;
      this.setData({ couponUnused: unused, promoClaimingPack: '' });
      try {
        const summary = wx.getStorageSync('couponSummary') || {};
        summary.unused = unused;
        wx.setStorageSync('couponSummary', summary);
      } catch (_) {
        /* ignore */
      }
      wx.showToast({
        title: (res && res.note) || '领取成功',
        icon: 'none',
        duration: 2200,
      });
      // 每天只能选一张：领完即关
      setTimeout(() => this.closePromoPop(), 600);
    } catch (err) {
      this.setData({ promoClaimingPack: '' });
      wx.showToast({ title: (err && err.message) || '领取失败', icon: 'none' });
    }
  },

  runAfterLotteryQueue() {
    if (this.data.showPromoPop) return;
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
    this.setData({
      showLottery: false,
      lotterySpinning: false,
      lotteryResult: null,
      wheelTransition: 'none',
    });
    this.maybeShowPromoPop().then((shown) => {
      if (!shown) this.runAfterLotteryQueue();
    });
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
