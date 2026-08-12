/**
 * 支付成功后的统一副作用：云打印等
 */
const { load, save } = require('../db');
const { pushFeie, pushYilianyun } = require('./cloudPrint');

async function onOrderPaid(order) {
  if (!order || !order.pickupCode) return { printed: false };

  if (process.env.CLOUD_PRINT_ENABLED !== 'true') {
    return { printed: false, skip: 'cloud打印未开启' };
  }

  const db = load();
  const shopName = db.settings?.shopName || '四季果先';
  const provider = (process.env.CLOUD_PRINT_PROVIDER || 'feie').toLowerCase();

  try {
    let result;
    if (provider === 'yilianyun' || provider === 'yly') {
      result = await pushYilianyun(order, shopName);
    } else {
      result = await pushFeie(order, shopName);
    }

    const latest = load();
    const o = latest.orders.find((x) => x.id === order.id);
    if (o) {
      o.printed = true;
      o.printedAt = Date.now();
      o.printProvider = provider;
      o.printResult = typeof result === 'object' ? result : { raw: result };
      o.updatedAt = Date.now();
      save(latest);
    }
    console.log(`[cloud-print] ${order.pickupCode} via ${provider} ok`);
    return { printed: true, provider, result };
  } catch (e) {
    console.error(`[cloud-print] ${order.pickupCode} fail:`, e.message);
    return { printed: false, error: e.message };
  }
}

module.exports = { onOrderPaid };
