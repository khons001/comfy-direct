# Comfy Direct

让 AI Agent 调用你的 ComfyUI，从参考图生成视频，并自动取回 H3 原片与 SeedVR2 高清版。

[下载安装包](https://github.com/khons001/comfy-direct/releases/latest)

## 功能

- 上传参考图并提交视频生成任务。
- 按需求设置提示词、时长、画面比例和高清放大。
- 查询生成进度，保存任务记录。
- 自动下载原片与高清版。
- 通过请求标识避免重复提交，按任务 ID 继续查询和取回结果。

## 选择安装方式

| 安装方式 | 适用场景 | 入口 |
| --- | --- | --- |
| 通用 MCP | 支持本地 stdio MCP 的 Agent 客户端 | `generic-mcp/` |
| Codex 插件 | 使用 Codex 管理和调用工具 | 仓库根目录 |

通用 MCP 方式不要求安装 Codex，模型由你使用的 Agent 客户端配置。Codex 插件安装脚本使用 Codex CLI。

## 快速开始

### 1. 准备服务器

准备已安装对应模型、节点和工作流的 ComfyUI 服务器，并取得自己的 SSH 连接信息。

### 2. 安装本地工具

下载并完整解压安装包。你可以让具有本机命令执行权限的 Agent 帮助安装：

> 请阅读安装包中的使用说明，帮我安装 Comfy Direct，并接入当前客户端。需要服务器连接信息时告诉我，密码由我在本机窗口输入。

也可以手动运行对应安装脚本：

| 系统 | 通用 MCP | Codex 插件 |
| --- | --- | --- |
| Windows | `安装通用MCP-Windows.ps1` | `安装插件-Windows.ps1` |
| macOS | `安装通用MCP-Mac.sh` | `安装插件-Mac.sh` |

安装脚本会准备本地运行环境。通用 MCP 安装完成后，将生成的 `mcp-client.json` 中的工具配置添加到客户端。

### 3. 连接服务器

按提示填写 SSH 连接命令，在本机连接窗口输入密码，并保持连接窗口打开。服务器地址或端口变化时，更新连接配置。

### 4. 开始生成

向 Agent 提供参考图并描述需求，例如：

> 用这张参考图生成一段 10 秒的雨夜视频，加入轻柔的背景音乐，同时返回 H3 原片和高清放大版。

Agent 调用工具提交任务、查询进度，并在完成后取回视频。

## 运行配置

- 本地运行时：Node.js 22.18 或更高版本，安装脚本可自动准备。
- 默认本地转发端口：`18190`。
- 默认服务器 ComfyUI 端口：`8188`。
- 默认生成参数：10 秒、0.6MP、关闭 Turbo，可按需求和显存调整。
- 服务器模型和算力由使用者自行准备。

任务记录和视频保存在本地用户数据目录，独立于插件缓存。密码由 SSH 读取，不写入连接配置。

## 使用说明

- [通用 MCP 安装说明](generic-mcp/先看这里.txt)
- [Codex 插件安装说明](Codex插件使用说明.txt)
- [版本下载](https://github.com/khons001/comfy-direct/releases)

## 服务器一键安装

教程所用 Linux / Python 3.12 环境，在服务器终端执行以下命令：

```bash
cd /root/sj-tmp && curl -fL --retry 3 https://github.com/khons001/comfy-direct/releases/download/v0.1.2/video-server-install.run -o video-server-install.run && echo '91871405a928b63f5de8ae2c12f101ca86d42cf5e83f3440908aa9fde2e4f6a8  video-server-install.run' | sha256sum -c - && bash video-server-install.run
```

安装目录为 `/root/sj-tmp/video-demo/ComfyUI`。安装包内含源码和下载清单，运行时会下载所需模型。
