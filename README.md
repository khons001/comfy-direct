# Comfy Direct · 通用 MCP

让 Agent 连接自己的 ComfyUI，生成并取回视频。视频用 Codex 演示；安装工具只有一套通用 MCP。

[按视频操作的五步教程](https://khons.cloud/comfy-direct.html#downloads) · [完整操作与排错说明](部署与使用.txt)

## 按教学视频的顺序操作

1. 租好服务器，设置密码。
2. 复制平台自己的 SSH 命令，在电脑终端登录服务器。
3. 在这个服务器窗口安装环境，完成后再运行启动命令，启动 ComfyUI。
4. 回到 Agent，让它下载安装通用 MCP。
5. 把自己的 SSH 命令发给 Agent，在连接窗口输入密码；连接检查通过后，发参考图生成视频。

第 4 步发给 Agent 的话：

> 请从 https://github.com/khons001/comfy-direct 帮我下载、安装并配置 Comfy Direct 通用 MCP。服务器已经按教程启动，需要服务器连接信息时告诉我，完成后检查工具能否正常调用。

## 给 Agent 的执行说明

先读取[部署与使用.txt](部署与使用.txt)中的技术说明。第 4 步由 Agent 下载、校验、解压安装包并合并客户端 MCP 配置；尚未取得 SSH 信息时，Windows 使用 `-PrepareOnly`，Mac 使用 `--prepare-only`。第 5 步取得 SSH 后再配置连接，复用用户已经启动的 ComfyUI。不要让用户重复安装服务器，不使用旧专属插件。

下面是安装和排错参考，普通用户按上方五步操作即可。

## 本地安装

唯一的新用户安装入口是 `generic-mcp/`，或同版本通用 MCP ZIP。由 Agent 下载、校验并完整解压，在该目录运行对应脚本：

- Windows：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./安装通用MCP-Windows.ps1`
- Mac（尚未真机验证）：`bash 安装通用MCP-Mac.sh`

安装器准备Node并输出实际MCP配置路径。客户端须能启动本地stdio进程、访问本机图片；普通网页聊天、模型API或只接受远程MCP URL的客户端不能直接使用。不同客户端的配置格式与视频展示方式仍需分别适配。

## 路径和端口

| 配置项 | 含义 |
| --- | --- |
| SSH用户、主机、端口 | 来自使用者自己的平台连接命令 |
| remote_root | 服务器ComfyUI绝对目录；算家云示例/root/sj-tmp/video-demo/ComfyUI |
| remote_port | 服务器ComfyUI监听端口，默认8188，可修改 |
| 本地转发端口 | 默认18190；首次配置避开占用，也可--local-port auto |
| MCP连接 | stdio，由客户端启动本地程序，不另开公网端口 |

Windows安装参数：`-SshCommand`、`-RemoteRoot`、`-RemotePort`、`-LocalPort auto`、`-Destination`。Mac对应长参数：`--ssh-command`、`--remote-root`、`--remote-port`、`--local-port auto`。没有服务器时可分别用`-PrepareOnly` / `--prepare-only`只准备工具。

已有直接可访问的ComfyUI可用`--endpoint`，此模式不使用SSH。127.0.0.1:18190是电脑到ComfyUI的转发地址，不是远程MCP URL。

密码不存入配置；任务、引用图片和视频保留在安装目录data/中。更新时保留数据，不要移动安装目录后继续使用旧客户端路径。

## 检查与验证范围

comfy_check核对连接、GPU、工作流节点和已注册的模型/枚举选项。缺模型或只有CPU时不会提交新生成。检查通过不能保证显存足够或模型内容完整，最终仍以实际生成、取回、播放验证。

v0.1.3已验证：Windows隔离目录、便携Node、独立stdio MCP发现7个工具、自定义路径与端口、重复配置保留、CPU/模型缺失拦截。Mac、ARM64和所有Agent客户端未逐个真机验证；本轮没有新租GPU或执行真实GPU视频生成。

旧版专属插件文件仅为已有安装保留兼容，不属于新用户安装流程。不要运行根目录的旧插件安装脚本来安装通用MCP。

## 源码

- generic-mcp/server/：独立MCP核心、连接逻辑和远端启动脚本。
- generic-mcp/setup/：同版本嵌入包与运行时准备。
- server-install/：Linux安装器源码、锁定依赖和模型清单。源码归档与wheel在服务器安装包中提供，不随Git重复存放。
