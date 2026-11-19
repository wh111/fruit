param(
  [Parameter(Mandatory = $true)]
  [string]$JsonFile
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $JsonFile)) { throw "NO_DATA" }
$raw = [IO.File]::ReadAllText($JsonFile, [Text.UTF8Encoding]::new($false))
$ticket = $raw | ConvertFrom-Json
if (-not $ticket) { throw "EMPTY" }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class UsbPrint {
  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVICE_INTERFACE_DATA {
    public int cbSize;
    public Guid InterfaceClassGuid;
    public int Flags;
    public IntPtr Reserved;
  }
  [DllImport("setupapi.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, string enumerator, IntPtr hwndParent, uint flags);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool SetupDiEnumDeviceInterfaces(IntPtr hDevInfo, IntPtr devInfo, ref Guid interfaceClassGuid, uint memberIndex, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr hDevInfo, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData, IntPtr deviceInterfaceDetailData, int deviceInterfaceDetailDataSize, out int requiredSize, IntPtr deviceInfoData);
  [DllImport("setupapi.dll", SetLastError = true)]
  public static extern bool SetupDiDestroyDeviceInfoList(IntPtr hDevInfo);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool WriteFile(IntPtr hFile, byte[] lpBuffer, int nNumberOfBytesToWrite, out int lpNumberOfBytesWritten, IntPtr lpOverlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);
  public static string Detail(IntPtr h, ref SP_DEVICE_INTERFACE_DATA data) {
    int size;
    SetupDiGetDeviceInterfaceDetail(h, ref data, IntPtr.Zero, 0, out size, IntPtr.Zero);
    IntPtr buf = Marshal.AllocHGlobal(size);
    try {
      Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
      if (!SetupDiGetDeviceInterfaceDetail(h, ref data, buf, size, out size, IntPtr.Zero)) return null;
      return Marshal.PtrToStringAuto(new IntPtr(buf.ToInt64() + 4));
    } finally { Marshal.FreeHGlobal(buf); }
  }
}
"@

$guid = [Guid]'28d78fad-5a12-11d1-ae5b-0000f803a8c2'
$h = [UsbPrint]::SetupDiGetClassDevs([ref]$guid, $null, [IntPtr]::Zero, 18)
if ($h -eq [IntPtr]::new(-1)) { throw "NO_USB_LIST" }
$target = $null
$i = 0
while ($true) {
  $data = New-Object UsbPrint+SP_DEVICE_INTERFACE_DATA
  $data.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][UsbPrint+SP_DEVICE_INTERFACE_DATA])
  $ok = [UsbPrint]::SetupDiEnumDeviceInterfaces($h, [IntPtr]::Zero, [ref]$guid, [uint32]$i, [ref]$data)
  if (-not $ok) { break }
  $p = [UsbPrint]::Detail($h, [ref]$data)
  if ($p -and ($p -match 'vid_0483&pid_5743' -or $p -match 'POS-80' -or $p -match 'printerpos-80')) { $target = $p; break }
  $i++
}
[UsbPrint]::SetupDiDestroyDeviceInfoList($h) | Out-Null
if (-not $target) { throw "NO_PRINTER" }

function Add-Bytes([System.Collections.Generic.List[byte]]$buf, [byte[]]$more) {
  foreach ($b in $more) { [void]$buf.Add($b) }
}
function Add-Text([System.Collections.Generic.List[byte]]$buf, [string]$text) {
  if (-not $text) { return }
  $enc = [Text.Encoding]::GetEncoding(936)
  Add-Bytes $buf $enc.GetBytes($text)
}

$buf = New-Object 'System.Collections.Generic.List[byte]'
Add-Bytes $buf @(0x1B, 0x40, 0x1C, 0x26, 0x1B, 0x61, 0x01)
Add-Bytes $buf @(0x1D, 0x21, 0x00)
Add-Text $buf ([string]$ticket.shop)
Add-Bytes $buf @(0x0A)
Add-Text $buf '----------------'
Add-Bytes $buf @(0x0A, 0x0A)
Add-Bytes $buf @(0x1D, 0x21, 0x33)
Add-Text $buf ([string]$ticket.code)
Add-Bytes $buf @(0x0A, 0x0A)
Add-Bytes $buf @(0x1D, 0x21, 0x11)
Add-Text $buf ([string]$ticket.title)
Add-Bytes $buf @(0x0A)
if ($ticket.qty -and [int]$ticket.qty -gt 1) {
  Add-Text $buf ('x' + [string]$ticket.qty)
  Add-Bytes $buf @(0x0A)
}
$fruits = @($ticket.fruits)
if ($fruits.Count -gt 0) {
  Add-Bytes $buf @(0x0A, 0x1D, 0x21, 0x22)
  foreach ($f in $fruits) {
    if (-not $f) { continue }
    Add-Text $buf ([string]$f)
    Add-Bytes $buf @(0x0A)
  }
}
if ($ticket.toppingLine) {
  Add-Bytes $buf @(0x0A, 0x1D, 0x21, 0x11)
  Add-Text $buf ([string]$ticket.toppingLine)
  Add-Bytes $buf @(0x0A)
}
Add-Bytes $buf @(0x1D, 0x21, 0x00, 0x0A)
if ($ticket.time) {
  Add-Text $buf ([string]$ticket.time)
  Add-Bytes $buf @(0x0A)
}
Add-Text $buf '----------------'
Add-Bytes $buf @(0x0A, 0x0A, 0x0A, 0x0A)
Add-Bytes $buf @(0x1D, 0x56, 0x41, 0x10)

$bytes = $buf.ToArray()
$GENERIC_WRITE = 0x40000000
$OPEN_EXISTING = 3
$handle = [UsbPrint]::CreateFile($target, $GENERIC_WRITE, 3, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::new(-1)) {
  throw ('OPEN_FAIL {0}' -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
try {
  $written = 0
  $wok = [UsbPrint]::WriteFile($handle, $bytes, $bytes.Length, [ref]$written, [IntPtr]::Zero)
  if (-not $wok -or $written -ne $bytes.Length) {
    throw ('WRITE_FAIL {0}' -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  Write-Output $written
} finally {
  [UsbPrint]::CloseHandle($handle) | Out-Null
}
