软著项目生成器使用说明

首次使用前，请确认本机已安装并登录 Codex，且已安装 Node.js 22.21.0 和 Microsoft Word。默认标准模式自带 Electron 构建链，不要求单独安装 Edge 或 Inno Setup。

使用方法：双击“开始生成.bat”，选择默认标准业务模式，输入软件主题，确认推荐模板，再为调度、处理、复核和管理员设置四个不同的高强度密码，然后等待全部阶段完成。密码不会写入交付包，请单独保管。

生成期间的交互、八种模板、14 个阶段、15 个交付文件用途、申请表填写方法、失败排查和提交前检查清单见 docs/generator-usage-and-filing-guide.md。

成功结果位于本目录的“交付结果”文件夹。每次结果均为一个平铺目录，其中包含标准安装包、操作手册、源码材料、申请信息底稿、项目源码 ZIP、完整交付包 ZIP 和校验报告。

提交申请前，必须打开申请信息底稿，将所有“【申请人填写】”内容替换为真实信息，并核对软件名称、版本、完成日期和首次发表信息。

生成失败时，窗口会显示保留的工作区和日志路径。可根据日志中的失败阶段排查后重新生成。

安装包未进行商业代码签名，Windows SmartScreen 可能显示未识别发布者提示。这不影响安装包的标准安装与卸载结构。

本工具用于准备和整理材料，不保证审批结果。最终材料内容、权属信息及申报合规性由申请人负责核对。

业务蓝图开发检查

以下命令用于修改蓝图协议、目录或校验器后的开发检查：

npm --prefix engine ci
npm --prefix engine run build:blueprint-validator
npm --prefix engine run test:blueprint
node engine/blueprint/cli.cjs --input <绝对路径到蓝图.json>
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1

npm 依赖只用于从 JSON Schema 重新生成已纳入源码的独立校验器。生成器正常验证业务蓝图时只需要现有 Node.js，不需要运行 npm install，也不需要联网。

桌面业务底座开发

新桌面业务底座位于 engine/desktop-runtime，采用 Electron、React、TypeScript 和 SQLite。第一版生产领域包、桥接包、八模板组合和 Windows 安装验收已经接入“开始生成.bat”，并作为默认模式；原有四页面模板仅通过 LegacyDemo 显式选择。

进入 engine/desktop-runtime 后，可以依次执行 npm ci、npm run typecheck、npm run test:unit、npm run test:integration、npm run build、npm run test:e2e 和 npm run dist:win。详细安全边界、测试账号及打包验证方式见该目录 README.md。

领域包组合器开发

领域包协议与组合器位于 engine/domain-packs。进入该目录后执行 npm ci、npm run typecheck、npm test、npm run test:combinations 和 npm run build。组合器只加载显式绝对路径的领域包，生成 canonical blueprint、版本锁和组合报告；测试 fixture 不会进入生产插件目录。

完整的克隆、环境初始化、统一验证和正式参考安装包说明见 README.md。开发环境统一使用 Node.js 22.21.0，可双击 setup-dev.bat 安装锁定依赖，双击 verify-dev.bat 运行默认全量检查。
