软著项目生成器使用说明

首次使用前，请确认本机已安装 Codex、Node.js、Microsoft Edge 和 Microsoft Word。Inno Setup 6 缺失时，生成器会在确认后安装经过签名校验的版本。

使用方法：双击“开始生成.bat”，输入一个简短的软件主题，例如“设备点检记录管理”，然后等待全部阶段完成。

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
