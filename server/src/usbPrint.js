const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'usb-print.ps1');
const MAX_HEX = 2_000_000;

function collectHex(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    throw Object.assign(new Error('没有打印数据'), { status: 400 });
  }
  const lines = [];
  for (const page of pages) {
    const parts = Array.isArray(page) ? page : [page];
    const hex = parts.map((part) => String(part || '').replace(/\s+/g, '')).join('');
    if (!hex) continue;
    if (hex.length > MAX_HEX || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) {
      throw Object.assign(new Error('打印数据无效'), { status: 400 });
    }
    lines.push(hex);
  }
  if (!lines.length) throw Object.assign(new Error('没有打印数据'), { status: 400 });
  return lines;
}

function writeHexPages(pages) {
  const lines = collectHex(pages);
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('USB 打印只在连接打印机的 Windows 电脑上可用'), { status: 400 });
  }
  const file = path.join(os.tmpdir(), `sg-usb-${Date.now()}-${Math.random().toString(16).slice(2)}.hex`);
  fs.writeFileSync(file, lines.join('\n'), 'ascii');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, file],
      { timeout: 20000, windowsHide: true },
      (err, stdout, stderr) => {
        fs.unlink(file, () => {});
        if (err) {
          const text = String(stderr || err.message || '');
          const known = [
            [/NO_PRINTER/, '没有找到 DP30 的 USB 打印口，请确认打印机已开机并插好数据线'],
            [/NO_DATA|EMPTY/, '没有打印数据'],
            [/BAD_DATA/, '打印数据无效'],
            [/OPEN_FAIL/, '打开打印机失败'],
            [/WRITE_FAIL/, '写入打印机失败'],
            [/NO_USB_LIST/, '无法枚举 USB 打印机'],
          ];
          const hit = known.find(([re]) => re.test(text));
          reject(Object.assign(new Error(hit ? hit[1] : 'USB 写入失败'), { status: 500 }));
          return;
        }
        const written = Number(String(stdout).trim().split(/\s+/).pop());
        resolve({ ok: true, written: Number.isFinite(written) ? written : 0 });
      }
    );
  });
}

module.exports = { writeHexPages, collectHex };
