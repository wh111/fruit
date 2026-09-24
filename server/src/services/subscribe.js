/**
 * 微信小程序订阅消息（一次性）
 *
 * WX_SUBSCRIBE_READY_TMPL_ID / WX_SUBSCRIBE_READY_KEYS / WX_SUBSCRIBE_STATE
 */
const { getAccessToken, requestJson } = require('./wechat');

function readyTmplId() {
  return String(process.env.WX_SUBSCRIBE_READY_TMPL_ID || '').trim();
}

function readyKeys() {
  const defaults = {
    product: 'thing1',
    place: 'thing2',
    code: 'character_string3',
    tip: 'thing4',
  };
  try {
    const raw = process.env.WX_SUBSCRIBE_READY_KEYS;
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaults;
}

function clip(val, max) {
  const s = String(val == null ? '' : val).replace(/\s+/g, ' ').trim();
  if (!s) return '-';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function formatNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildReadyPayload(order) {
  const tmplId = readyTmplId();
  if (!tmplId) return null;
  const openid = order.openid;
  if (!openid || String(openid).startsWith('dev_')) return null;

  const locker = order.deliveryPoint && order.deliveryPoint !== 'shop';
  const place = locker ? order.deliveryPointName || '外卖柜' : '四季果先柜台';
  const tip = locker
    ? `已投柜请取 码${order.pickupCode || ''}`
    : `请到店取餐 码${order.pickupCode || ''}`;

  const keys = readyKeys();
  const data = {
    [keys.product]: { value: clip(order.productName || '果切', 20) },
    [keys.place]: { value: clip(place, 20) },
    [keys.code]: { value: clip(order.pickupCode || order.orderNo || '-', 32) },
    [keys.tip]: { value: clip(tip, 20) },
  };
  if (keys.time) data[keys.time] = { value: formatNow() };

  return {
    touser: openid,
    template_id: tmplId,
    page: `pages/order/order?id=${order.id}`,
    miniprogram_state: process.env.WX_SUBSCRIBE_STATE || 'formal',
    lang: 'zh_CN',
    data,
  };
}

async function sendSubscribeMessage(payload) {
  if (!payload) return { skipped: true, reason: 'no_payload' };
  let token = await getAccessToken();
  let data = await requestJson(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { method: 'POST', bodyObj: payload }
  );
  if (data.errcode === 40001 || data.errcode === 42001) {
    token = await getAccessToken(true);
    data = await requestJson(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      { method: 'POST', bodyObj: payload }
    );
  }
  if (data.errcode && data.errcode !== 0) return { ok: false, ...data };
  return { ok: true, msgid: data.msgid, ...data };
}

async function notifyOrderReady(order) {
  try {
    if (!readyTmplId()) return { skipped: true, reason: 'tmpl_not_configured' };
    const payload = buildReadyPayload(order);
    if (!payload) return { skipped: true, reason: 'no_openid_or_payload' };
    const result = await sendSubscribeMessage(payload);
    if (!result.ok && !result.skipped) {
      console.warn('[subscribe] ready fail', order.pickupCode, result.errcode, result.errmsg);
    } else if (result.ok) {
      console.log('[subscribe] ready ok', order.pickupCode, result.msgid);
    }
    return result;
  } catch (e) {
    console.warn('[subscribe] ready error', e.message);
    return { ok: false, error: e.message };
  }
}

function subscribeClientConfig() {
  const id = readyTmplId();
  return { enabled: Boolean(id), tmplIds: id ? [id] : [] };
}

module.exports = {
  getAccessToken,
  notifyOrderReady,
  subscribeClientConfig,
  buildReadyPayload,
};
