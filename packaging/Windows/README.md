# 从 Python 官方发行包重新构建 Windows 离线包

工作台 1.0.0 使用 CPython 3.14.10 的 Windows embeddable distribution。维护者在 Windows、macOS 或 Linux 上使用 Python 3.9 及以上版本即可组装。客户下载的 ZIP 自带运行时。

1. 新建本地缓存目录 `vendor-cache`，从 Python 官方下载这两个 ZIP，保持文件名。
   - [python-3.14.10-embed-amd64.zip](https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip)
   - [python-3.14.10-embed-arm64.zip](https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-arm64.zip)
2. 在仓库根目录运行下列命令。Windows 维护者可将 `python3` 换成自己的 Python 命令。第一个命令需要一个尚未创建的输出目录。

   ```sh
   python3 packaging/Windows/prepare_runtime.py --cache vendor-cache --out build/windows-runtime
   python3 packaging/build_release.py --platform Windows --version 1.0.0 --runtime build/windows-runtime
   ```

3. 成品为 `dist/客户反馈工作台-1.0.0-Windows.zip`。对最终 ZIP 重新解压、运行并核对 SHA-256。上传为 Release 附件后，可从仓库 Actions 页面手动运行 **Verify Windows release ZIP**；选择发布标签并输入附件的实际名称。

准备脚本离线工作。它使用[官方版本页](https://www.python.org/downloads/release/python-31410/)公布的 SHA-256 核对两个 ZIP，保留两套上游文件和 LICENSE.txt，逐字节复制仓库保存的 [x64 SPDX](https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip.spdx.json)、[ARM64 SPDX](https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-arm64.zip.spdx.json) 清单及运行时 NOTICE.txt。仓库 `upstream/` 下的元数据也会校验 SHA-256。

交付的客户包面向 Windows 10/11 x64 和 Windows 11 ARM64，双击脚本按系统架构选择解释器。[CPython 平台说明](https://docs.python.org/3.14/using/windows.html#supported-windows-versions)
