# 软著项目生成器

面向 Windows 的离线业务软件与软著交付材料生成器。第一版包含领域包组合、业务蓝图校验、Electron + React + SQLite 桌面运行时、Windows 安装包构建以及交付材料整理流程。

## 支持环境

开发和构建统一使用：

- Windows 10/11 x64
- Node.js 22.21.0（见 `.node-version`）
- npm（随 Node.js 安装）
- Windows PowerShell 5.1
- Git

运行完整生成器还需要：

- 已安装并登录的 Codex CLI
- Microsoft Word 桌面版

默认标准业务模式使用 Electron/Playwright 截图和 electron-builder/NSIS 打包，不要求单独安装 Edge 或 Inno Setup。只有显式选择旧版 `LegacyDemo` 时才需要 Edge 和 Inno Setup。普通源码开发、领域测试和桌面运行时测试不需要 Word、Edge、Codex 或 Inno Setup。

## 克隆与初始化

```powershell
git clone https://github.com/ltfGH/rz_project.git
cd rz_project
git checkout feature/next-update
.\setup-dev.bat
```

`setup-dev.bat` 会先检查 Node.js、npm、Git、PowerShell 和锁文件，然后在以下三个目录执行 `npm ci`：

- `engine`
- `engine/domain-packs`
- `engine/desktop-runtime`

脚本只安装 `package-lock.json` 锁定的版本，不会修改锁文件。也可以只检查环境：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-DevelopmentEnvironment.ps1
```

## 运行生成器

先检查生成器专用工具：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\engine\Generate.ps1 -PreflightOnly -Theme "环境检查"
```

随后双击 `开始生成.bat`，或执行：

```powershell
.\开始生成.bat
```

依次选择生成模式、输入软件主题、确认推荐模板，再为调度、处理、复核、管理员设置四个不同的高强度密码。标准模式支持申请审批归档、资产巡检管理、资产巡检整改、资产工单运维、巡检整改工单、库存申领审批、项目交付归档、项目任务管理八种受控模板。密码明文不会写入交付物，需由操作人另行保管和交付。

结果写入 `交付结果`，过程工作区和日志分别位于 `engine/工作区`、`engine/日志`。标准结果是 15 个平铺文件，包含实际 Electron 安装包、材料、源码归档、业务蓝图、领域版本锁、验收报告、校验报告和完整交付包。提交软著申请前必须替换材料中的所有“【申请人填写】”内容并核对权属信息。

生成过程交互、14 个标准阶段、15 个交付文件、申请表填写规则和提交前检查清单见 [生成器使用与申报填写指南](docs/generator-usage-and-filing-guide.md)。

## 统一验证

运行默认完整开发检查（不启动 GUI；首次缺少 Electron 二进制时可能联网下载）：

```powershell
.\verify-dev.bat
```

它覆盖蓝图校验器、非外部工具 PowerShell 测试、领域包类型检查与 `8/8` 组合矩阵、桌面运行时类型检查、单元/集成测试和构建。

需要额外执行包含真实 Edge 截图的旧版外部管线测试时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeExternalPipelineTests
```

需要额外运行 Electron 测试时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeE2E
```

需要运行代表模板的完整标准生成验收（会启动 Electron、Word、安装器，耗时较长）时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeStandardBusinessAcceptance
```

完整参考软件打包态闭环测试会下载 Electron 构建文件并生成临时高熵账号密码：

```powershell
cd engine\desktop-runtime
npm run test:e2e:reference
```

## 正式参考安装包

复制 `.env.example` 中的变量名，为四个正式账号分别生成 scrypt 摘要。示例：

```powershell
cd engine\desktop-runtime
$env:RZ_PASSWORD = '<由交付负责人设置的高强度密码>'
node tools/hash-password.cjs
```

把四次输出分别设置为：

- `RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST`
- `RZ_REFERENCE_OPERATOR_PASSWORD_DIGEST`
- `RZ_REFERENCE_REVIEWER_PASSWORD_DIGEST`
- `RZ_REFERENCE_ADMINISTRATOR_PASSWORD_DIGEST`

然后执行：

```powershell
npm run dist:win:reference
```

发布构建缺少任一摘要都会失败。密码明文不得写入仓库、`.env.example`、日志或安装包；密码与安装包应通过不同渠道交付。更完整的包体、安装器和验收报告命令见 `engine/desktop-runtime/README.md`。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `engine/Generate.ps1` | 生成任务编排入口 |
| `engine/blueprint` | 业务蓝图协议和独立校验器 |
| `engine/domain-packs` | 生产领域包、桥接包和组合器 |
| `engine/desktop-runtime` | Electron 离线业务运行时与参考软件 |
| `engine/template` | 旧版四页面模板，保留兼容 |
| `docs` | 设计、实施计划和验收说明 |
| `交付结果` | 本机生成的交付物，不提交 Git |

## 常见问题

**Node 版本不正确**

安装 Node.js 22.21.0 后重新打开终端，确认 `node --version` 输出 `v22.21.0`。

**PowerShell 禁止执行脚本**

使用仓库提供的 `.bat` 入口，或在命令中加入 `-ExecutionPolicy Bypass`。不需要永久修改系统执行策略。

**`npm ci` 或 Electron 下载失败**

三个锁文件使用 npm 官方 registry 地址。确认网络可以访问 npm 和 Electron 下载源后重试；需要使用镜像时通过本机 npm 配置或临时设置 `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR`，不要把代理令牌写入仓库。

**生成器预检失败**

根据 `Generate.ps1 -PreflightOnly` 输出安装缺失的 Codex CLI、Node、npm、npx 或 Word。该预检只确认 Codex 命令存在，不检查账号登录状态；首次生成前还需单独确认 Codex 已登录。旧版模式的预检仍会检查 Edge 和 Inno Setup。

**Windows 显示“未知发布者”**

当前安装包没有商业代码签名，SmartScreen 可能提示未知发布者。这不影响标准安装和卸载结构。

## 安全与范围

本工具用于生成离线业务软件和整理软著材料，不保证审批结果。最终材料内容、申请人信息、软件权属和申报合规性由使用者负责核对。仓库禁止提交 token、正式密码、数据库、日志和生成安装包。
