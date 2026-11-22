# 重新组装客户 ZIP

仓库中的 app/ 对应本地分发版，包含前端资源、Python 认证服务、双击入口调用的启动模块与跨端口恢复模块。客户发行包无需另外安装 Python。维护者重新组装时可按下面步骤复用已检验的运行时。

1. 从本项目的同一 Release 下载目标系统 ZIP，核对发布的 SHA-256。完整解压，找到其中的 runtime/。保留全部文件、双架构目录和许可证。二进制供应商、补丁版本、原始来源与校验值随 runtime/ 提供。升级 Python 时应按该清单重新核实依赖、授权、最低系统与各架构启动行为。
2. 在源码仓库根目录执行相应命令，将最后一个参数替换为解压所得 runtime/ 的路径。

```sh
python3 packaging/build_release.py --platform macOS --version 1.0.0 --runtime "/path/to/macOS/runtime"
python3 packaging/build_release.py --platform Windows --version 1.0.0 --runtime "/path/to/Windows/runtime"
```

成品位于 dist/。脚本使用明确的业务文件清单；MAC 启动文件和解释器的执行位写在 ZIP 中。重新发布前，应从新 ZIP 解压并运行，验证登录、注册审批、业务导入导出、端口占用与跨重启数据保留。应用自身的授权由权利人决定，第三方许可证随各自运行时分发。

## 首次构建

macOS 的两个官方运行时归档来自 [Astral 的 20261110 发行版](https://github.com/astral-sh/python-build-standalone/releases/tag/20261110)。从 macOS/vendor-notices 下两份架构说明中的 Runtime source 下载相应文件，保留原名。执行 `python3 packaging/macOS/prepare_runtime.py 缓存目录 新的运行时目录`，再把生成目录交给 build_release.py。脚本校验固定 SHA-256 并附上上游许可证。

Windows 的两份嵌入式运行时来自 [Python 3.14.10](https://www.python.org/downloads/release/python-31410/)。请参见 Windows 子目录的维护说明与准备脚本。

发布后，可在 GitHub Actions 中手动运行 **Verify Windows release ZIP**，分别使用 x64 和 ARM64 Windows runner 验证已上传的附件。运行需要仓库可使用相应 runner，默认不会触发或发布。
