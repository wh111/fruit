/**
 * 云打印：飞鹅 / 易联云
 *
 * 飞鹅：
 *   CLOUD_PRINT_PROVIDER=feie
 *   CLOUD_PRINT_USER / CLOUD_PRINT_UKEY / CLOUD_PRINT_SN
 *
 * 易联云：
 *   CLOUD_PRINT_PROVIDER=yilianyun
 *   YLY_CLIENT_ID / YLY_CLIENT_SECRET / YLY_MACHINE_CODE / YLY_ACCESS_TOKEN
 *   （若未填 ACCESS_TOKEN，会用 client 凭证自动换取）
 */
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

function pickupLine(order) {
  let time = '现作现取';
  if (order.fulfillmentType === 'reserve' && (order.pickupAtText || order.pickupAt)) {
    time = `预约取餐：${order.pickupAtText || order.pickupAt}`;
  }
  if (order.deliveryPoint && order.deliveryPoint !== 'shop') {
    return `${time}\n投柜：${order.deliveryPointName || order.deliveryPoint}`;
  }
  return `${time}\n送达：到店取`;
}

function amountLine(order) {
  const fee = Number(order.deliveryFee) > 0 ? ` 含配送￥${order.deliveryFee}` : '';
  if (order.discountAmount > 0 && order.originalAmount) {
    return `金额：￥${order.amount}（原价￥${order.originalAmount} ${order.discountLabel || '优惠券'}${fee}）`;
  }
  return `金额：￥${order.amount}${fee}`;
}

function itemLines(order) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : null;
  if (items) {
    return items.map((it) => {
      const tops = (it.toppings || []).map((t) => t.name).filter(Boolean);
      const ex = (it.extras || [])
        .filter((e) => e && e.kind !== 'sideMeal' && e.kind !== 'topping')
        .map((e) => e.name);
      const add = [...tops, ...ex].join('+');
      return `${it.productName} ${it.specName} x${it.quantity}${add ? `（${add}）` : ''}`;
    });
  }
  return [`${order.productName} ${order.specName} x${order.quantity}`];
}

function extrasSummary(order) {
  const sides = (order.extras || []).filter((e) => e && e.kind === 'sideMeal').map((e) => e.name);
  if (sides.length) return sides.join('+');
  if (Array.isArray(order.items) && order.items.length) return '见上';
  return (order.extras || []).map((e) => e.name).join('+') || '无';
}

function buildCloudTicket(order, shopName = '四季果先') {
  const time = new Date(order.paidAt || order.createdAt);
  const ts = `${time.getMonth() + 1}-${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const goods = itemLines(order);
  return [
    `<CB>${shopName}</CB>`,
    `<CB>取餐码 ${order.pickupCode}</CB>`,
    `--------------------------------`,
    ...goods.map((g) => `商品：${g}`),
    `加料：${extrasSummary(order)}`,
    amountLine(order),
    pickupLine(order),
    `下单：${ts}`,
    `单号：${order.orderNo}`,
    `--------------------------------`,
    `<QR>${order.qrPayload || order.orderNo}</QR>`,
    `请核对取餐码后制作`,
  ].join('<BR>');
}

/** 易联云纯文本（无飞鹅标签） */
function buildYlyContent(order, shopName = '四季果先') {
  const time = new Date(order.paidAt || order.createdAt);
  const ts = `${time.getMonth() + 1}-${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const goods = itemLines(order);
  return [
    `@@2 ${shopName}`,
    `@@2 取餐码 ${order.pickupCode}`,
    `----------------`,
    ...goods.map((g) => `商品：${g}`),
    `加料：${extrasSummary(order)}`,
    amountLine(order),
    pickupLine(order),
    `下单：${ts}`,
    `单号：${order.orderNo}`,
    `请核对取餐码制作`,
  ].join('\n');
}

function requestText(url, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function pushFeie(order, shopName) {
  const user = process.env.CLOUD_PRINT_USER;
  const ukey = process.env.CLOUD_PRINT_UKEY;
  const sn = process.env.CLOUD_PRINT_SN;
  if (!user || !ukey || !sn) {
    throw new Error('请配置 CLOUD_PRINT_USER / CLOUD_PRINT_UKEY / CLOUD_PRINT_SN');
  }
  const stime = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha1').update(user + ukey + stime).digest('hex');
  const content = buildCloudTicket(order, shopName);
  const body = new URLSearchParams({
    user,
    stime: String(stime),
    sig,
    apiname: 'Open_printMsg',
    sn,
    content,
    times: '1',
  }).toString();
  const text = await requestText('https://api.feieyun.cn/Api/Open/', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (json.ret !== undefined && Number(json.ret) !== 0) {
    throw new Error(json.msg || `飞鹅打印失败 ret=${json.ret}`);
  }
  return json;
}

let ylyTokenCache = { token: '', exp: 0 };

async function getYlyToken() {
  if (process.env.YLY_ACCESS_TOKEN) return process.env.YLY_ACCESS_TOKEN;
  if (ylyTokenCache.token && Date.now() < ylyTokenCache.exp) return ylyTokenCache.token;

  const clientId = process.env.YLY_CLIENT_ID;
  const clientSecret = process.env.YLY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('请配置 YLY_CLIENT_ID / YLY_CLIENT_SECRET，或直接填 YLY_ACCESS_TOKEN');
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = crypto
    .createHash('md5')
    .update(clientId + timestamp + clientSecret)
    .digest('hex');
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'client_credentials',
    sign,
    scope: 'all',
    timestamp,
    id: crypto.randomUUID(),
  }).toString();
  const text = await requestText('https://open-api.10ss.net/oauth/oauth', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const json = JSON.parse(text);
  const token = json?.body?.access_token || json?.access_token;
  if (!token) throw new Error(json?.error_description || json?.error || '易联云获取 token 失败');
  ylyTokenCache = { token, exp: Date.now() + 7000 * 1000 };
  return token;
}

async function pushYilianyun(order, shopName) {
  const machineCode = process.env.YLY_MACHINE_CODE || process.env.CLOUD_PRINT_SN;
  if (!machineCode) throw new Error('请配置 YLY_MACHINE_CODE（打印机终端号）');
  const clientId = process.env.YLY_CLIENT_ID;
  const clientSecret = process.env.YLY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('请配置 YLY_CLIENT_ID / YLY_CLIENT_SECRET');
  }

  const accessToken = await getYlyToken();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = crypto
    .createHash('md5')
    .update(clientId + timestamp + clientSecret)
    .digest('hex');
  const content = buildYlyContent(order, shopName);
  const body = new URLSearchParams({
    client_id: clientId,
    access_token: accessToken,
    machine_code: machineCode,
    content,
    origin_id: order.orderNo || order.id,
    sign,
    id: crypto.randomUUID(),
    timestamp,
  }).toString();

  const text = await requestText('https://open-api.10ss.net/print/index', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (json.error !== '0' && json.error !== 0 && json.error_description) {
    throw new Error(json.error_description || '易联云打印失败');
  }
  return json;
}

module.exports = { buildCloudTicket, buildYlyContent, pushFeie, pushYilianyun };
