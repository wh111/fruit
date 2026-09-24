/**
 * 手机号绑定：同一手机号合并到同一用户，保证券/月累计一致
 */
const { getUserPhoneNumber, decryptPhoneData, maskPhone } = require('./wechat');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function publicUser(user) {
  if (!user) return null;
  const phone = normalizePhone(user.phone);
  return {
    id: user.id,
    nickName: user.nickName || '果粉',
    avatarUrl: user.avatarUrl || '',
    phone: phone || '',
    phoneMasked: phone ? maskPhone(phone) : '',
    hasPhone: Boolean(phone),
  };
}

/**
 * 将 fromUser 的券、订单并入 toUser，保留 toUser，删除 fromUser。
 * 未使用的券作废（避免新 openid 再领一遍欢迎券导致翻倍），已用券与订单迁到手机号账号。
 */
function mergeUserInto(db, fromUser, toUser) {
  if (!fromUser || !toUser || fromUser.id === toUser.id) return toUser;
  for (const c of db.coupons || []) {
    if (c.userId !== fromUser.id) continue;
    if (c.status === 'unused') {
      c.status = 'merged_void';
      c.voidReason = 'phone_merge';
      c.voidAt = Date.now();
    }
    c.userId = toUser.id;
  }
  for (const o of db.orders || []) {
    if (o.userId === fromUser.id) {
      o.userId = toUser.id;
      if (fromUser.openid && (!o.openid || o.openid === fromUser.openid)) {
        o.openid = toUser.openid || fromUser.openid;
      }
    }
  }
  if (fromUser.openid && fromUser.openid !== toUser.openid) {
    toUser.openid = fromUser.openid;
  }
  if (fromUser.sessionKey && !toUser.sessionKey) toUser.sessionKey = fromUser.sessionKey;
  if (fromUser.nickName && (!toUser.nickName || toUser.nickName === '果粉')) {
    toUser.nickName = fromUser.nickName;
  }
  if (fromUser.avatarUrl && !toUser.avatarUrl) toUser.avatarUrl = fromUser.avatarUrl;
  db.users = (db.users || []).filter((u) => u.id !== fromUser.id);
  return toUser;
}

/**
 * 绑定手机号；若该号已有账号则合并
 * 支持：新版 code / 旧版 encryptedData+iv / 开发 mockPhone
 */
async function bindPhoneForUser(db, currentUser, { code, encryptedData, iv, mockPhone } = {}) {
  if (!currentUser) throw Object.assign(new Error('请先登录'), { status: 401 });

  let phone = '';
  if (code) {
    const info = await getUserPhoneNumber(code);
    phone = normalizePhone(info.purePhoneNumber || info.phoneNumber);
  } else if (encryptedData && iv) {
    if (!currentUser.sessionKey) {
      throw Object.assign(new Error('登录态已过期，请先重新登录再授权手机号'), { status: 401 });
    }
    const info = decryptPhoneData(currentUser.sessionKey, encryptedData, iv);
    phone = normalizePhone(info.purePhoneNumber || info.phoneNumber);
  } else if (mockPhone && (process.env.PAY_MODE === 'mock' || process.env.ALLOW_MOCK_PHONE === '1')) {
    phone = normalizePhone(mockPhone);
  } else {
    throw Object.assign(new Error('未获得手机号凭证，请用真机重试或检查小程序手机号权限'), { status: 400 });
  }

  if (!phone || phone.length < 11) {
    throw Object.assign(new Error('手机号无效'), { status: 400 });
  }

  const existing = (db.users || []).find(
    (u) => u.id !== currentUser.id && normalizePhone(u.phone) === phone
  );

  let user = currentUser;
  let merged = false;
  if (existing) {
    user = mergeUserInto(db, currentUser, existing);
    merged = true;
  }

  user.phone = phone;
  user.phoneBoundAt = Date.now();
  user.updatedAt = Date.now();
  return { user, merged, phone };
}

module.exports = {
  normalizePhone,
  publicUser,
  mergeUserInto,
  bindPhoneForUser,
  maskPhone,
};
