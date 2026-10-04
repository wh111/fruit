param(
  [Parameter(Mandatory = $true)]
  [string]$HexFile
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $HexFile)) { throw "NO_DATA" }
$lines = @(Get-Content -LiteralPath $HexFile | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($lines.Count -eq 0) { throw "EMPTY" }

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
  if ($p -and $p -match 'vid_0483&pid_5a19&mi_00') { $target = $p; break }
  $i++
}
[UsbPrint]::SetupDiDestroyDeviceInfoList($h) | Out-Null
if (-not $target) { throw "NO_PRINTER" }

$GENERIC_WRITE = 0x40000000
$OPEN_EXISTING = 3
$handle = [UsbPrint]::CreateFile($target, $GENERIC_WRITE, 3, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::new(-1)) {
  throw ("OPEN_FAIL {0}" -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
$writtenTotal = 0
try {
  foreach ($hex in $lines) {
    if ($hex.Length % 2 -ne 0 -or $hex -notmatch '^[0-9A-Fa-f]+$') { throw "BAD_DATA" }
    $bytes = New-Object byte[] ($hex.Length / 2)
    for ($n = 0; $n -lt $bytes.Length; $n++) {
      $bytes[$n] = [Convert]::ToByte($hex.Substring($n * 2, 2), 16)
    }
    $written = 0
    $wok = [UsbPrint]::WriteFile($handle, $bytes, $bytes.Length, [ref]$written, [IntPtr]::Zero)
    if (-not $wok -or $written -ne $bytes.Length) {
      throw ("WRITE_FAIL {0}" -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
    $writtenTotal += $written
  }
} finally {
  [UsbPrint]::CloseHandle($handle) | Out-Null
}
Write-Output $writtenTotal
