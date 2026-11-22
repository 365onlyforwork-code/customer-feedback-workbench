# 贝翰战略咨询 · 客户反馈工作台

客户可在本机导入 XLSX、CSV 或 TSV，按业务规则分析反馈，跟进工单、对照抽查方案并导出结果。提供中文和英文界面。创作者为 Yanbing Min。

## 从 Releases 下载

在本仓库的 Releases 选择 1.0.0。Windows 版和 macOS 版是各自独立的 ZIP，内含 x64 与 ARM64 两套 Python 运行时。客户只需完整解压，双击最外层的 **Start 客户反馈工作台.cmd** 或 **Start 客户反馈工作台.command**。具体系统要求、首次登录及数据备份见 ZIP 根目录的《开始使用.txt》。浏览器使用本机已安装的现代浏览器。

## 开发者从源码运行

前端为原生 HTML、CSS 和 JavaScript。Python HTTP 服务提供认证与 SQLite 账号审批。无 npm 包或第三方 Python 包依赖。macOS 或 Windows 上使用 Python 3.9+ 可从仓库根目录执行：

```sh
python3 app/local_start.py
```

Windows 安装 Python 的开发者可使用 `py -3 app/local_start.py`。首次启动会生成本机随机管理员密码，打开浏览器，并在启动窗口显示地址与登录资料的位置。服务只监听 127.0.0.1。

## 代码与数据

- `app/` 包含业务页面、字体样式、分类与抽查逻辑，以及原有 Python 服务。本地包入口为 `app/local_start.py`。
- `app/portable_state.py` 与 `app/assets/portable-state.js` 管理本机恢复副本。读写须使用已登录的账号及同一个浏览器配置，保存会校验版本，以免另一个窗口覆盖现有工作。
- `packaging/` 包含双击启动文件、客户指南与 ZIP 组装脚本。二进制运行时随 Release 分发，许可证位于各包的 `runtime/`。README 中的运行命令只供从源码开发时使用。
- Windows 数据目录为 `%LOCALAPPDATA%\Beihan\CustomerFeedback`，Mac 为 `~/Library/Application Support/Beihan/CustomerFeedback`。SQLite 保存账号和本机恢复副本；浏览器继续以原格式保存项目。示例项目为合成数据。
- 反馈负责人是工单字段，同一台电脑上不同账号或浏览器配置分别管理项目。本地启动版不提供在线团队同步。

## 发布附件

将仓库代码提交到 GitHub；在 Releases 中创建对应版本标签（本版为 `v1.0.0`），上传 Windows ZIP、macOS ZIP 及 SHA256SUMS.txt。客户通过 Release 下载安装，无须使用“Code → Download ZIP”。静态 GitHub Pages 不执行 Python 登录服务。

维护者可用仓库中的打包脚本复用已核验的两个平台运行时。具体命令见 [打包说明](packaging/README.md)。
