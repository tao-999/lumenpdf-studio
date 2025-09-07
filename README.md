# LumenPDF Studio

> 一个跨平台的桌面 PDF 工具，采用 **Tauri + React + TypeScript + Vite** 构建，轻巧如风，强大如光。

---
![微信图片_20250901191704_1_39](https://github.com/user-attachments/assets/640f82e4-f3f1-41c9-ba54-ff33db4cf67a)

##  技术栈
- 框架：React + TypeScript，结合 Vite 构建
- 桌面容器：Tauri（Rust + WebView2），轻量、安全、性能优
- 构建工具：pnpm + Vite + Tauri CLI
- 配置管理：包含 `.vscode` 设置、`tsconfig`、`vite.config.ts` 等

---

##  项目结构
```
├── public/              # 静态资源文件夹
├── src/                 # React 前端源码
├── src-tauri/           # Tauri 后端 Rust 源码
├── .vscode/             # 编辑器配置
├── package.json         # npm 脚本 & 依赖
├── pnpm-lock.yaml       # pnpm 锁定文件
├── tsconfig*.json       # TypeScript 配置
└── vite.config.ts       # Vite 构建配置
```

---

##  快速体验

首先克隆仓库：
```bash
git clone https://github.com/tao-999/lumenpdf-studio.git
cd lumenpdf-studio
```

安装依赖并启动开发环境：
```bash
pnpm install
pnpm tauri dev
```

启动后你就能在本地体验 Tauri 打包出的跨平台桌面应用。

---

##  构建打包

- **开发构建**：
  ```bash
  pnpm build
  pnpm tauri build
  ```
- 打包后可在 `src-tauri/target/release` 目录找到安装包或可执行文件。

---

##  亮点功能（假设预计功能，可按项目内容替换）
- PDF 渲染 & 查看（支持缩放、分页）
- 页面编辑：添加标注、注释、签名
- 导出：裁剪、导出为图片、PDF 另存为等
- 系统集成：拖放支持，剪贴板图像导入

---

##  贡献指南
欢迎开发者一起完善功能：

1. Fork 本仓库  
2. 新建分支：`feature/xxx`  
3. 提交功能：`git commit -m "feat: xxx"`  
4. Push 分支，发起 Pull Request  

建议提交前执行 `pnpm lint` 和 `pnpm test`（若有配置）。

---

##  许可证
MIT License。欢迎自由使用、学习、传播。

