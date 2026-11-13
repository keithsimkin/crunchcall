"""Capture the annotated Electron window to a PNG."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from pathlib import Path

from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()

EnumWindows = user32.EnumWindows
EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
GetWindowTextW = user32.GetWindowTextW
GetWindowTextLengthW = user32.GetWindowTextLengthW
IsWindowVisible = user32.IsWindowVisible
GetWindowRect = user32.GetWindowRect
PrintWindow = user32.PrintWindow
CreateCompatibleDC = gdi32.CreateCompatibleDC
CreateCompatibleBitmap = gdi32.CreateCompatibleBitmap
SelectObject = gdi32.SelectObject
DeleteObject = gdi32.DeleteObject
DeleteDC = gdi32.DeleteDC
GetDIBits = gdi32.GetDIBits
SetForegroundWindow = user32.SetForegroundWindow
ShowWindow = user32.ShowWindow

PW_RENDERFULLCONTENT = 0x00000002
SW_RESTORE = 9


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', wintypes.DWORD),
        ('biWidth', ctypes.c_long),
        ('biHeight', ctypes.c_long),
        ('biPlanes', wintypes.WORD),
        ('biBitCount', wintypes.WORD),
        ('biCompression', wintypes.DWORD),
        ('biSizeImage', wintypes.DWORD),
        ('biXPelsPerMeter', ctypes.c_long),
        ('biYPelsPerMeter', ctypes.c_long),
        ('biClrUsed', wintypes.DWORD),
        ('biClrImportant', wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [('bmiHeader', BITMAPINFOHEADER), ('bmiColors', wintypes.DWORD * 3)]


def find_annotated() -> int:
    found: list[int] = []

    def cb(hwnd: int, _: int) -> bool:
        if not IsWindowVisible(hwnd):
            return True
        n = GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        GetWindowTextW(hwnd, buf, n + 1)
        if buf.value == 'annotated' or buf.value.startswith('annotated'):
            found.append(hwnd)
        return True

    EnumWindows(EnumWindowsProc(cb), 0)
    if not found:
        raise SystemExit('No annotated window found')
    return found[0]


def capture(hwnd: int, out: Path) -> tuple[int, int]:
    ShowWindow(hwnd, SW_RESTORE)
    SetForegroundWindow(hwnd)
    rect = wintypes.RECT()
    GetWindowRect(hwnd, ctypes.byref(rect))
    w = rect.right - rect.left
    h = rect.bottom - rect.top
    hdc = user32.GetWindowDC(hwnd)
    memdc = CreateCompatibleDC(hdc)
    bmp = CreateCompatibleBitmap(hdc, w, h)
    old = SelectObject(memdc, bmp)
    PrintWindow(hwnd, memdc, PW_RENDERFULLCONTENT)

    bmi = BITMAPINFO()
    ctypes.memset(ctypes.byref(bmi), 0, ctypes.sizeof(bmi))
    bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = w
    bmi.bmiHeader.biHeight = -h
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = 0
    buf = ctypes.create_string_buffer(w * h * 4)
    GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    img = Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1).convert('RGB')
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)

    SelectObject(memdc, old)
    DeleteObject(bmp)
    DeleteDC(memdc)
    user32.ReleaseDC(hwnd, hdc)
    return w, h


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    hwnd = find_annotated()
    w, h = capture(hwnd, args.out)
    print(f'saved {args.out} {w}x{h}')


if __name__ == '__main__':
    main()
