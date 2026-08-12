function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildLabelHtml({ order, qrDataUrl, shopName }) {
  const extras = (order.extras || []).map((e) => e.name).join('+') || '无加料';
  const time = new Date(order.paidAt || order.createdAt);
  const timeStr = `${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

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
  .code { font-size: 22px; font-weight: 800; line-height: 1; color: #222; }
  .name { font-size: 10px; color: #333; margin-top: 1mm; }
  .sub { font-size: 8px; color: #666; }
  .time { font-size: 8px; color: #999; }
</style>
</head>
<body>
  <div class="label">
    <img class="qr" src="${qrDataUrl}" alt="qr"/>
    <div class="meta">
      <div>
        <div class="brand">${escapeHtml(shopName || '四季果先')}</div>
        <div class="code">${escapeHtml(order.pickupCode)}</div>
        <div class="name">${escapeHtml(order.productName)} · ${escapeHtml(order.specName)}</div>
        <div class="sub">${escapeHtml(extras)} ×${order.quantity}</div>
      </div>
      <div class="time">${timeStr}</div>
    </div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body>
</html>`;
}

module.exports = { buildLabelHtml };
