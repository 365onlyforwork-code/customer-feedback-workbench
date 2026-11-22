# Customer Feedback Workbench · Beihan Strategy Consulting

Import XLSX, CSV, or TSV files, analyze feedback, track cases, compare review samples, and export results. The interface is available in English and Chinese. Created by Yanbing Min.

## Download

**[Download for Windows](https://github.com/365onlyforwork-code/customer-feedback-workbench/releases/download/v1.0.0/CustomerFeedback-1.0.0-Windows.zip)** · **[Download for macOS](https://github.com/365onlyforwork-code/customer-feedback-workbench/releases/download/v1.0.0/CustomerFeedback-1.0.0-macOS.zip)** · [Release notes and checksums](https://github.com/365onlyforwork-code/customer-feedback-workbench/releases/tag/v1.0.0)

| Platform | Supported versions |
| --- | --- |
| Windows | Windows 10/11 x64 and Windows 11 ARM64 |
| macOS | macOS 14 or later, on Apple silicon or Intel |

Extract the entire ZIP. On Windows, double-click **Start 客户反馈工作台.cmd**. On macOS, double-click **Start 客户反馈工作台.command**. Both packages include the runtime. The launch window shows the administrator password on first run. See the bundled `开始使用.txt` (Getting Started) for details.

## Run from source

The interface uses plain HTML, CSS, and JavaScript. A Python HTTP service handles authentication and stores account approvals in SQLite. The project requires Python 3.9 or later and has no npm or third-party Python dependencies. Run this command from the repository root on macOS or Windows.

```sh
python3 app/local_start.py
```

On Windows, you can also run `py -3 app/local_start.py`. On first launch, the service generates a random administrator password for the machine and opens the browser. The launch window shows the local URL and the location of the sign-in details. The service listens on `127.0.0.1`.

## Code and local data

- `app/` contains the business pages, styles, classification and sampling logic, and Python server. The local entry point is `app/local_start.py`.
- `app/portable_state.py` and `app/assets/portable-state.js` manage local recovery copies. Access requires the same browser profile and signed-in account. Version checks prevent another window from overwriting more recent data.
- `packaging/` contains launch scripts, customer guides, and the ZIP builder. Release packages include runtime licenses in `runtime/`.
- The local data directory is `%LOCALAPPDATA%\Beihan\CustomerFeedback` on Windows or `~/Library/Application Support/Beihan/CustomerFeedback` on macOS. SQLite stores accounts and local recovery copies. The browser continues to store projects in their original format. Example projects use synthetic data.
- Case ownership is recorded on each item. Different accounts and browser profiles maintain separate projects on the same machine. This local edition supports individual workspaces.

## Release packaging

Create a version tag, such as `v1.0.0`, and attach the Windows ZIP, macOS ZIP, and `SHA256SUMS.txt` to the GitHub Release. Customers can download the packages directly from Releases. Authentication requires the Python service.

See the [packaging guide](packaging/README.md) for steps to reuse the verified platform runtimes and build the ZIP files.
