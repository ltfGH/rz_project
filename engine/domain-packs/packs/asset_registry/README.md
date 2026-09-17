# 资产台账领域包

`asset_registry@1.0.0` 为离线业务软件提供资产分类、资产台账、责任关系和资产事件能力，提供领域能力 `asset.core`。本包兼容业务蓝图 `1.0` 与桌面运行时 `1.0.0`。

## 数据模型

| 实体 | 用途 | 保留规则 |
| --- | --- | --- |
| `asset_category` | 资产分类 | 被资产引用时限制删除 |
| `asset` | 资产主档与当前状态 | 存在责任或事件历史时禁止硬删除 |
| `asset_responsibility` | 当前及历史责任关系 | 历史保留，换绑时结束旧记录并新增记录 |
| `asset_event` | 创建、状态和责任变更事件 | 系统管理，只追加，不允许修改或删除 |

资产状态为 `active`、`maintenance`、`inactive`。允许的转换为：

- `active -> maintenance`
- `maintenance -> active`
- `active -> inactive`
- `maintenance -> inactive`
- `inactive -> active`

状态变更要求权限 `assets.change_status`，责任分配与换绑要求领域权限 `asset_responsibilities.assign`。通用仓储不允许直接更新资产状态或创建责任历史。状态或责任变更必须在调用方提供的 SQLite 事务中同时更新资产版本、追加领域事件并写入审计。

## 停用阻断

`AssetLifecycleContext.blockers` 接受其他领域包注册的阻断器。只有转换到 `inactive` 时才执行阻断器；任一阻断器返回 `blocked: true`，整个事务以 `INVALID_TRANSITION` 失败。例如，工单包可用它阻止仍有未关闭工单的资产停用。

运行时服务不创建数据库连接、不自行开启事务，也不访问网络。调用方必须注入 actor、权限检查、审计写入、时钟、事件编码器和 `assigneeExists` 身份解析器。责任标识只有在调用方拥有的用户或岗位注册表中存在时才能写入，显示文本本身不能作为有效性依据。

## UI 扩展

本包只注册以下固定槽位：

- `entity.detail.tabs`：责任关系、状态历史
- `entity.detail.actions`：状态操作组

描述符为纯数据，不替换登录、主导航、维护、备份恢复或通用错误页面，也不直接调用 IPC 或数据库。

## 确定性种子

```ts
generateAssetSeed({ seed, categoryCount, assetCount })
```

`seed` 必须为 32 位整数，`categoryCount` 为 1–100，`assetCount` 为 1–10000。同一组参数产生字节稳定结果。输出包含指定数量的分类和资产，并为每项资产生成一条当前责任与一条初始事件。示例名称均为通用设备、区域和责任岗位，不包含真实企业或个人身份。

## 边界

本包不实现工单、巡检、项目任务、设备在线采集或外部通知。相关能力由其他领域包通过公开扩展点和停用阻断器组合。本包也不直接执行资产删除；`assertCanDelete` 仅提供给底座删除服务作为历史守卫。

## 验证

从 `engine/domain-packs` 执行：

```powershell
npm run typecheck
npm test
npm run build
```

单包验收会使用真实 SQLite 建档、分配责任、切换维护状态，并核对仪表盘、领域事件和审计记录。
