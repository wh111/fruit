const { formatHm } = require('./promo');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildLabelHtml({ order, qrDataUrl, shopName }) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : null;
  const nameLine = items
    ? items.map((it) => `${it.productName}×${it.quantity}`).join('、')
    : `${order.productName} · ${order.specName}`;
  const fruitNames = [];
  const seenFruit = new Set();
  const addFruit = (n) => {
    const name = String(n || '').trim();
    if (!name || seenFruit.has(name)) return;
    seenFruit.add(name);
    fruitNames.push(name);
  };
  const extraFruitsOf = (list) =>
    (list || [])
      .filter((e) => e && e.kind !== 'topping' && e.kind !== 'sideMeal')
      .forEach((e) => addFruit(typeof e === 'string' ? e : e.name));
  extraFruitsOf(order.extras);
  (items || []).forEach((it) => extraFruitsOf(it.extras));
  const side = (order.extras || []).find((e) => e && e.kind === 'sideMeal');
  const toppingNames = [];
  const seenTop = new Set();
  const addTop = (n) => {
    const name = String(n || '').trim();
    if (!name || seenTop.has(name)) return;
    seenTop.add(name);
    toppingNames.push(name);
  };
  (order.toppings || []).forEach((t) => addTop(t && t.name));
  (items || []).forEach((it) => (it.toppings || []).forEach((t) => addTop(t && t.name)));
  (order.extras || []).forEach((e) => {
    if (e && e.kind !== 'sideMeal') addTop(e.name);
  });
  const toppingText = toppingNames.join('+');
  const extras = side
    ? side.name
    : [fruitNames.join('+'), toppingText ? `小料${toppingText}` : ''].filter(Boolean).join(' ') ||
      (items ? `共${order.quantity}件` : '无加料');
  const time = new Date(order.paidAt || order.createdAt);
  const timeStr = `${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const pickupStr =
    order.fulfillmentType === 'reserve' && order.pickupAt
      ? `预约 ${formatHm(order.pickupAt)}`
      : `现取 ${timeStr}`;
  const deliveryStr =
    order.deliveryPoint && order.deliveryPoint !== 'shop'
      ? escapeHtml(order.deliveryPointName || order.deliveryPoint)
      : '到店取';
  const priceStr =
    order.discountAmount > 0 && order.originalAmount
      ? `¥${order.amount}（原价¥${order.originalAmount}）`
      : `¥${order.amount}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>标签-${escapeHtml(order.pickupCode)}</title>
<style>
  @page { size: 50mm 30mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  .label {
    width: 50mm; height: 30mm; padding: 1.5mm 2mm;
    display: flex; gap: 2mm; border: 0.2mm dashed #ccc;
  }
  .qr { width: 18mm; height: 18mm; object-fit: contain; align-self: center; }
  .meta { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { font-size: 9px; color: #4CAF50; font-weight: 700; letter-spacing: 0.5px; }
  .code { font-size: 14px; font-weight: 800; line-height: 1.1; color: #222; }
  .name { font-size: 12px; color: #333; margin-top: 0.6mm; font-weight: 700; }
  .sub { font-size: 13px; color: #9a3412; font-weight: 800; line-height: 1.25; }
  .time { font-size: 7px; color: #999; }
</style>
</head>
<body>
  <div class="label">
    <img class="qr" src="${qrDataUrl}" alt="qr"/>
    <div class="meta">
      <div>
        <div class="brand">${escapeHtml(shopName || '四季果先')}</div>
        <div class="code">${escapeHtml(order.pickupCode)}</div>
        <div class="name">${escapeHtml(nameLine)}</div>
        <div class="sub">${escapeHtml(extras)} · ${escapeHtml(priceStr)}</div>
      </div>
      <div class="time">${escapeHtml(pickupStr)} · ${deliveryStr}</div>
    </div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body>
</html>`;
}

module.exports = { buildLabelHtml };
