const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'receipt-print.ps1');

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function cleanText(value, max = 80) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildTicket(body) {
  const ticket = body && body.ticket ? body.ticket : body;
  if (!ticket || typeof ticket !== 'object') {
    throw Object.assign(new Error('没有小票数据'), { status: 400 });
  }
  const fruits = asList(ticket.fruits)
    .map((n) => cleanText(n, 40))
    .filter(Boolean)
    .slice(0, 12);
  const qty = Math.max(1, Math.min(99, Number(ticket.qty) || 1));
  return {
    shop: cleanText(ticket.shop, 20) || '四季果先',
    code: cleanText(ticket.code, 16) || '',
    title: cleanText(ticket.title, 40) || '',
    fruits,
    toppingLine: cleanText(ticket.toppingLine, 60),
    qty,
    time: cleanText(ticket.time, 40),
  };
}

function printReceipt(body) {
  const ticket = buildTicket(body);
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('热敏打印只在连接打印机的 Windows 电脑上可用'), { status: 400 });
  }
  const file = path.join(os.tmpdir(), `sg-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(ticket), 'utf8');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, file],
      { timeout: 25000, windowsHide: true },
      (err, stdout, stderr) => {
        fs.unlink(file, () => {});
        if (err) {
          const text = String(stderr || err.message || '');
          const known = [
            [/NO_PRINTER/, '没有找到 POS-80 热敏打印机，请确认已开机并插好 USB'],
            [/NO_DATA|EMPTY/, '没有小票数据'],
            [/OPEN_FAIL/, '打开热敏打印机失败'],
            [/WRITE_FAIL/, '写入热敏打印机失败'],
            [/NO_USB_LIST/, '无法枚举 USB 打印机'],
          ];
          const hit = known.find(([re]) => re.test(text));
          reject(Object.assign(new Error(hit ? hit[1] : '热敏打印失败'), { status: 500 }));
          return;
        }
        const written = Number(String(stdout).trim().split(/\s+/).pop());
        resolve({ ok: true, written: Number.isFinite(written) ? written : 0 });
      }
    );
  });
}

module.exports = { printReceipt, buildTicket };
