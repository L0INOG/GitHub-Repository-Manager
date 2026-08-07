# GitHub Repository Manager 开源项目学习报告与超级完全体升级方案

## 1. 学习对象

本次为了改进 GitHub Repository Manager，下载并学习了 5 个开源项目，全部存放在本项目根目录的 `download/` 下，每个项目独立一个文件夹：

| 项目 | 本地位置 | 技术栈 | 核心价值 |
| --- | --- | --- | --- |
| GitView | `download/GitView` | Python + Tkinter + GitHub REST API | 完整的云端仓库浏览、上传、下载、分支切换 |
| RepoKai | `download/RepoKai` | Rust + Tauri + 原生 Web UI | 三栏仓库浏览器、README 渲染、仓库信息面板 |
| GitHub Desktop | `download/GitHubDesktop` | Electron + React + TypeScript | 成熟桌面客户端架构、窗口控制、Git 交互体验 |
| GitButler | `download/GitButler` | Tauri + Rust + Svelte/React | 现代版本控制体验、安全 IPC、高质量界面 |
| remoto.el | `download/remoto-el` | Emacs Lisp + GitHub API | “不克隆也能像本地一样浏览仓库”的 Tree API 缓存模型 |

## 2. 各项目技术细节

### 2.1 GitView

GitView 是和我们目标最接近的云端仓库管理工具。它证明了“不需要本地仓库，只靠 GitHub Contents API 就能完成日常文件管理”的可行性。

值得学习的点：

- 使用 `GET /repos/{owner}/{repo}/branches` 动态加载分支，并在切换分支后重新拉取目录。
- 文件上传使用 Contents API，目录上传递归展开本地目录，每个文件单独提交。
- 下载使用 GitHub 的 ZIP 归档接口 `GET /repos/{owner}/{repo}/archive/refs/heads/{branch}.zip`，简单可靠。
- 文件操作全部通过 `contents` 接口完成：新建、重命名、删除、复制。
- 内置搜索、语法高亮、提交历史索引。

我们保留：

- 云端优先、无本地仓库的工作模式。
- 分支选择器。
- 递归上传、下载、复制、重命名、删除。
- 当前目录即时筛选。

我们舍弃：

- Tkinter 的界面框架，视觉和交互不够现代。
- 每次操作都产生多个 API 调用却缺少“操作完成后确认云端已同步”的等待机制。
- 把所有逻辑塞进单个超大文件，维护成本高。

### 2.2 RepoKai

RepoKai 是一个 Tauri 桌面应用，也是三栏布局：仓库列表、仓库信息、README。

值得学习的点：

- 仓库列表直接展示名称、语言、可见性、描述、星标、最近更新时间。
- README 从 GitHub API 读取并支持 Markdown 渲染。
- 支持我的仓库和 Starred 仓库两种来源。
- 提供发布本地仓库、克隆仓库、编辑仓库描述和可见性等功能。

我们保留：

- 仓库信息面板：描述、语言、许可证、可见性、更新时间。
- README 渲染。
- 键盘导航和快捷操作。
- 仓库操作入口：新建、编辑、复制克隆地址、浏览器打开。

我们舍弃：

- 把本地仓库发布和克隆作为主要工作流，因为 GitHub Repository Manager 已经明确走纯云端路线。
- 仅查看 README 的被动浏览模式，我们还要直接编辑云端文件。

### 2.3 GitHub Desktop

GitHub Desktop 是桌面 Git 客户端的行业标杆，它给了我们很多工程层面的参考。

值得学习的点：

- 主进程、预加载脚本、渲染进程职责分离，安全边界清晰。
- 窗口控制按钮使用自定义 SVG，与系统标题栏一致。
- 主题通过 `body.theme-*` 类和 CSS 变量切换，并同步系统 `color-scheme`。
- 所有长任务都有进度状态、错误恢复和操作结果反馈。
- 分支、提交、差异、远程仓库都做了独立视图。

我们保留：

- Electron 安全模式：`contextIsolation` + 预加载桥接，不直接暴露 Node 能力。
- 自定义窗口控制并贴住右上角。
- 白天/黑夜双主题。
- 操作锁：转圈期间禁止继续操作，避免步骤混乱。

我们舍弃：

- GitHub Desktop 的本地仓库强绑定模型，因为它本质上仍是本地 Git 客户端。
- 庞大的本地 Git 面板，GitHub Repository Manager 以云端同步为唯一心智模型。

### 2.4 GitButler

GitButler 是目前最现代的 Git 管理产品之一。它的 Lite 版使用 Electron + React，并强调进程边界和类型安全的 IPC。

值得学习的点：

- 渲染进程只能通过 `window.lite.*` 调用受控 API，主进程再转发给 Rust 原生 SDK。
- 自定义 `lite://` 协议加载本地资源，避免直接使用 `file://`。
- 对所有外部打开 URL 做协议白名单校验。
- 使用 React Query、Redux、Worker 池处理异步状态和复杂交互。
- 窗口最小宽度、主题预览、原生菜单等细节打磨得很完整。

我们保留：

- 主进程和渲染进程之间保持薄 IPC 层。
- 外部链接只允许 `http/https` 协议。
- 异步操作集中管理，成功后才允许下一次操作。

我们舍弃：

- Rust 后端和复杂虚拟分支体系，当前产品只需要 GitHub API。
- 重度前端工程化配置，GitHub Repository Manager 保持零构建依赖即可运行。

### 2.5 remoto.el

remoto.el 是“不克隆也能浏览 GitHub 仓库”最纯粹的实现。

值得学习的点：

- 使用 Git Trees API `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` 一次性拉取整个仓库树。
- 目录列表、文件存在性、补全全部从内存树缓存读取，只有真正打开文件时才请求内容。
- 内容按 SHA 缓存，同一个文件重复打开不会重复下载。
- 大型仓库在 Trees API 返回 `truncated` 时降级到逐目录 Contents API。
- 支持 `@branch` 语法在不同分支间切换。

我们保留：

- 分支/引用作为云端路径的一部分。
- 当前目录使用 Contents API，适合实时编辑场景。
- 操作后轮询云端树，确认同步完成才释放界面。

我们舍弃：

- 只读模型。GitHub Repository Manager 必须支持创建、修改、删除、上传，不能只做浏览。
- Emacs 虚拟文件系统方案，桌面应用直接使用 DOM 文件列表更直观。

## 3. 借鉴后确定的产品原则

1. 云端即唯一真相：仓库内容实时来自 GitHub，不创建隐藏本地仓库。
2. 操作必须闭环：每次写操作后轮询云端树，确认数据出现/消失后才结束转圈。
3. 分支是云端路径的一部分：切换分支等于切换整个浏览上下文。
4. 预览优先：目录选中时展示 README 和仓库信息，文件选中时进入编辑器。
5. 安全边界清晰：Token 只存在主进程，渲染进程不能直接访问文件系统。
6. 界面保持安静、专业：白天/黑夜主题一致，窗口控件贴住右上角，面板宽度可调并记忆。

## 4. 超级完全体升级清单

根据以上学习，GitHub Repository Manager 将完成以下升级：

### 云端仓库管理

- [x] GitHub Token 登录、安全存储
- [x] 云端仓库列表、搜索、排序
- [x] 新建仓库
- [x] 仓库描述和可见性编辑
- [x] 仓库右键菜单：浏览器打开、复制地址、复制 SSH/HTTPS

### 文件浏览

- [x] GitHub 风格单列文件列表
- [x] 分支选择与切换
- [x] 面包屑导航
- [x] 当前目录筛选
- [x] 仓库内文件搜索
- [x] 文件夹展开/收拢
- [x] 文件下载、文件夹下载、整仓 ZIP 下载
- [x] 云端文件右键菜单：打开、重命名、复制、删除、复制路径、复制链接

### 编辑器与预览

- [x] 文本编辑、图片预览、二进制识别
- [x] README Markdown 预览
- [x] 仓库信息面板：描述、语言、可见性、更新时间
- [x] 最近提交列表
- [x] 分支列表

### 交互与稳定性

- [x] 全局操作转圈锁
- [x] 云端同步轮询校验
- [x] 白天/黑夜主题
- [x] 面板宽度拖拽和记忆
- [x] 窗口控件贴住右上角
- [x] 快捷键：`Ctrl+S` 保存、`Ctrl+F` 聚焦文件搜索、`Ctrl+N` 新建文件、`Ctrl+Shift+N` 新建文件夹、`Ctrl+Shift+R` 刷新、`Ctrl+,` 切换主题
- [x] 安全 IPC：外部链接协议白名单

## 5. 最终交付

升级完成后，`electron/main.js` 负责 GitHub API 和文件下载，`electron/preload.js` 只暴露受控 API，`electron/renderer/app.js` 负责界面和交互，`electron/renderer/styles.css` 负责双主题设计。完整功能以应用内实际行为为准。

本次实际落地的新能力包括：

- 仓库侧栏支持筛选，右键菜单可打开 GitHub、下载 ZIP、复制 HTTPS/SSH、编辑描述与可见性、刷新列表。
- 文件面板新增分支选择器、当前目录下载和整仓搜索。
- 打开仓库后默认展示仓库概览：描述、语言、星标、Fork、可见性、README、最近提交、分支列表。
- 云端文件右键菜单支持下载、在 GitHub 打开、查看历史、复制网页链接和 Raw 链接。
- 所有云端读写操作都携带当前分支参数，切换分支后文件、README、提交和搜索索引同步刷新。
