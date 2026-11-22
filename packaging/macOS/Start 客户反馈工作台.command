#!/bin/sh
# Run the offline workbench from the fully extracted release folder.
set -u
umask 077
fail() {
    printf '\n%s\n' "$1" >&2
    if [ -t 0 ]; then
        printf '按回车键关闭窗口。\n' >&2
        IFS= read -r answer || :
    fi
    exit 1
}
package_dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P) || fail '无法打开工作台所在的文件夹。'
case "$(/usr/bin/uname -m)" in
    arm64) runtime="$package_dir/runtime/arm64" ;;
    x86_64) runtime="$package_dir/runtime/x64" ;;
    *) fail '当前 Mac 处理器不在本包支持范围内。' ;;
esac
[ -x "$runtime/bin/python3.14" ] && [ -f "$package_dir/app/local_start.py" ] || fail '启动文件不完整。请完整解压 ZIP 后再双击启动。'
unset PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE
"$runtime/bin/python3.14" -I -B -X utf8 "$package_dir/app/local_start.py"
result=$?
[ "$result" = 0 ] || [ "$result" = 130 ] || fail "工作台启动或运行异常（$result）。请检查上方提示。"
