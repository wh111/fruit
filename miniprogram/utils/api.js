const config = require('./config');

function request(path, options = {}) {
  const token = wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: options.timeout || 15000,
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...(options.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
        }
      },
      fail(err) {
        const msg = (err && err.errMsg) || '网络错误';
        const tip = config.baseUrl;
        if (/合法域名|url not in domain list|not in domain/i.test(msg)) {
          reject(new Error(`域名未加入小程序白名单：${tip}。请在公众平台→开发管理→服务器域名，把 request/uploadFile/downloadFile 都填成该地址（需已 ICP 备案）`));
        } else if (/ssl|tls|certificate|握手/i.test(msg)) {
          reject(new Error(`HTTPS 失败：${tip}。请改用 4G 再试，办公室网络可能拦截该域名`));
        } else if (/timeout/i.test(msg)) {
          reject(new Error(`请求超时：${tip}`));
        } else if (/fail/i.test(msg)) {
          reject(new Error(`连不上后端 ${tip}。${msg}`));
        } else {
          reject(new Error(msg));
        }
      },
    });
  });
}

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${config.baseUrl}${path}`;
}

function wxLoginWithTimeout(ms = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve(code || `dev_${Date.now()}`);
    };
    const timer = setTimeout(() => finish(`dev_${Date.now()}`), ms);
    wx.login({
      success(res) {
        clearTimeout(timer);
        finish(res.code);
      },
      fail() {
        clearTimeout(timer);
        finish(`dev_${Date.now()}`);
      },
    });
  });
}

function rememberGrantPending(data) {
  if (data && data.welcomeGranted) {
    wx.setStorageSync('welcomeGrantedPending', {
      count: data.welcomeCouponCount || 21,
      at: Date.now(),
    });
  }
  if (data && data.monthlyGranted) {
    wx.setStorageSync('monthlyGrantedPending', {
      count: data.monthlyCouponCount || 3,
      at: Date.now(),
    });
  }
}

function clearSession() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.token = '';
      app.globalData.user = null;
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * 登录并确保发券：
 * - 无 token / force：走 wx.login → wxlogin（服务端发券）
 * - 有 token：调 /api/coupons/mine 发券；401 则清 token 重登
 * 解决：扫码进店沿用旧 token 时不发券、只有「重新登录」才有券
 */
async function ensureLogin(opts = {}) {
  const doWxLogin = async () => {
    const code = await wxLoginWithTimeout(8000);
    const data = await request('/api/auth/wxlogin', {
      method: 'POST',
      data: { code },
    });
    wx.setStorageSync('token', data.token);
    wx.setStorageSync('user', data.user);
    if (data.couponSummary) wx.setStorageSync('couponSummary', data.couponSummary);
    try {
      const app = getApp();
      app.globalData.token = data.token;
      app.globalData.user = data.user;
    } catch (_) {
      /* ignore */
    }
    rememberGrantPending(data);
    return {
      token: data.token,
      welcomeGranted: !!data.welcomeGranted,
      welcomeCouponCount: data.welcomeCouponCount || 0,
      monthlyGranted: !!data.monthlyGranted,
      monthlyCouponCount: data.monthlyCouponCount || 0,
      couponSummary: data.couponSummary,
      campaign: data.campaign,
    };
  };

  if (opts.force) clearSession();

  let token = wx.getStorageSync('token');
  if (token && !opts.force) {
    try {
      const mine = await request('/api/coupons/mine');
      if (mine.summary) wx.setStorageSync('couponSummary', mine.summary);
      rememberGrantPending(mine);
      return {
        token,
        welcomeGranted: !!mine.welcomeGranted,
        welcomeCouponCount: mine.welcomeCouponCount || 0,
        monthlyGranted: !!mine.monthlyGranted,
        monthlyCouponCount: mine.monthlyCouponCount || 0,
        couponSummary: mine.summary,
        reused: true,
      };
    } catch (e) {
      const msg = (e && e.message) || '';
      // token 失效或未登录 → 清掉重登
      if (/请先登录|未登录|401|无权/.test(msg) || !wx.getStorageSync('token')) {
        clearSession();
      } else {
        // 网络错误：保留 token，但告诉调用方这次没发到券
        return { token, welcomeGranted: false, monthlyGranted: false, offline: true };
      }
    }
  }

  return doWxLogin();
}

function rememberOrderId(id) {
  const ids = wx.getStorageSync('localOrderIds') || [];
  if (!ids.includes(id)) {
    ids.unshift(id);
    wx.setStorageSync('localOrderIds', ids.slice(0, 50));
  }
}

function consumeWelcomeToast() {
  const pending = wx.getStorageSync('welcomeGrantedPending');
  if (!pending || !pending.count) return null;
  wx.removeStorageSync('welcomeGrantedPending');
  return pending;
}

function consumeMonthlyToast() {
  const pending = wx.getStorageSync('monthlyGrantedPending');
  if (!pending || !pending.count) return null;
  wx.removeStorageSync('monthlyGrantedPending');
  return pending;
}

module.exports = {
  request,
  mediaUrl,
  ensureLogin,
  rememberOrderId,
  consumeWelcomeToast,
  consumeMonthlyToast,
  config,
};
