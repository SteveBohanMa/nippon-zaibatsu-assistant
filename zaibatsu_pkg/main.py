#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
財閥 — 对局助手  启动器 (.exe 外壳)
-----------------------------------------------------------------------------
打包成单文件 .exe 后双击即用：
  1) 优先以原生窗口 (pywebview) 打开内置的 app/index.html；
  2) 若 pywebview 不可用，则启动本地静态服务器并用默认浏览器打开。

应用全部逻辑在前端 (HTML/CSS/JS + 内置决策引擎)，本启动器只负责呈现窗口，
因此打包极稳，离线运行，无需任何在线依赖。
"""
import os
import sys
import threading
import http.server
import socketserver
import functools
import webbrowser

APP_TITLE = "財閥 — 对局助手"
APP_DIR_NAME = "app"


def resource_base():
    """定位资源目录：PyInstaller 冻结后在 sys._MEIPASS，否则为脚本所在目录。"""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def app_dir():
    return os.path.join(resource_base(), APP_DIR_NAME)


def index_path():
    return os.path.join(app_dir(), "index.html")


def run_native_window(url_or_file):
    """尝试用 pywebview 打开原生窗口。返回 True 表示成功承载。"""
    try:
        import webview  # pywebview
    except Exception:
        return False
    try:
        webview.create_window(
            APP_TITLE,
            url=url_or_file,
            width=1280,
            height=820,
            min_size=(960, 640),
            background_color="#141821",
        )
        webview.start()
        return True
    except Exception as exc:  # 某些环境缺少 WebView2 运行时
        print("[warn] pywebview 启动失败，回退浏览器：", exc, file=sys.stderr)
        return False


def start_local_server(directory):
    """启动一个仅本机可访问的静态服务器，返回 (端口, 线程)。"""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)

    class Quiet(socketserver.TCPServer):
        allow_reuse_address = True

        def __init__(self, *a, **k):
            super().__init__(*a, **k)

    # 绑定到 127.0.0.1，端口 0 = 让系统分配空闲端口
    httpd = Quiet(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return port, httpd


def main():
    idx = index_path()
    if not os.path.exists(idx):
        msg = f"找不到应用文件：{idx}\n请确认打包时已包含 app/ 目录。"
        try:
            import tkinter.messagebox as mb
            mb.showerror(APP_TITLE, msg)
        except Exception:
            print(msg, file=sys.stderr)
        sys.exit(1)

    # 方案 A：本地服务器 + 原生窗口（最稳，避免 file:// 的脚本加载限制）
    port, httpd = start_local_server(app_dir())
    url = f"http://127.0.0.1:{port}/index.html"

    if run_native_window(url):
        httpd.shutdown()
        return

    # 方案 B：回退到默认浏览器
    print(f"在浏览器中打开： {url}")
    webbrowser.open(url)
    print("应用已在浏览器打开。关闭此窗口将结束程序。")
    try:
        threading.Event().wait()  # 保持进程存活以维持本地服务器
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
