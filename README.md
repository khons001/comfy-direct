# Comfy Direct · 通用 MCP

让支持本地 stdio MCP 的 Agent 调用自己的 ComfyUI，生成并取回 H3 原片与 SeedVR2 高清版。无需安装 Codex 或专属插件，模型由所用客户端配置。

[完整部署教程](部署与使用.txt) · [网站教程](https://khons.cloud/comfy-direct.html)

## 一条安装流程

1. 准备匹配的 NVIDIA GPU / Linux x86_64 / Python 3.12 服务器，取得自己的 SSH 命令。已有环境先检查并复用。
2. 在服务器运行 Linux 安装器，使用 `--root` 指定真实 ComfyUI 目录。模型约48.3GB，依赖、缓存和视频另占空间；确认数据盘挂载、容量和费用。
3. 在自己的电脑安装通用 MCP，将生成的 `mcp-client.json` 按客户端格式合并到配置，保留其他工具。
4. 打开本地连接脚本，用户自行输入密码；工具复用或启动配置目录中的 ComfyUI。先运行 `comfy_check`。
5. 上传参考图并提交一次任务，按任务ID查询；两版视频下载且播放正常后才算完成。

## 本地安装

唯一的新用户安装入口是 `generic-mcp/`，或同版本通用 MCP ZIP。下载后完整解压，在该目录运行对应脚本：

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
