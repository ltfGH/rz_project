# 申请与归档领域包设计

## 1. 目标

实现生产级 `application_archive@1.0.0`，为离线业务软件提供多轮顺序审批、只追加审批记录、应用托管文件版本、申请归档、证照续期和软件内到期提醒。核心包可独立使用，并通过受控桥接支持库存领用审批、项目立项/交付审批和领域文档归档。

本包兼容业务蓝图 `1.0`、桌面运行时 `1.0.0`，提供能力 `application.core` 和 `archive.core`。

## 2. 范围与边界

本包负责：

- 申请草稿、提交、逐级审批、驳回、撤回、修改和重新提交；
- 每轮独立审批节点和只追加审批记录；
- 应用数据目录内的托管文件副本、SHA-256 和不可覆盖版本；
- 可恢复的 staged/ready/failed 文件导入；
- 批准申请及附件归档；
- 证照版本、续期、失效和归档文件关联；
- 幂等生成及确认软件内到期提醒；
- 动态汇总、确定性种子、生产插件和真实 SQLite/文件系统验收。

本包不负责并行会签、条件分支、加签、转签、电子签章、OCR、外部短信/邮件、在线对象存储、病毒扫描或全文检索。提醒只表示软件内待办，不宣称外部通知已送达。

## 3. 配置

- `approval_levels`：可选，整数 1–3，默认 2；
- `reminder_days`：可选，整数 0–365，默认 30；
- 未知配置、非整数或越界值在组合及运行时装载阶段失败关闭。

审批级别映射：

1. `application_reviewer`；
2. `application_compliance_reviewer`；
3. `application_archive_manager`。

## 4. 数据模型

### 4.1 `application`

- `code`：唯一稳定编码；
- `application_type`：申请类型；
- `title`、`content`：申请标题和正文；
- `applicant_id`：申请人身份；
- `status`：`draft | approving | approved | rejected | withdrawn | archived`；
- `approval_round`：当前审批轮次，草稿初始为 0；
- `current_node_code`：当前激活节点，可空；
- `submitted_at`、`approved_at`、`archived_at`：状态时间；
- `version`：乐观版本。

只有 `draft` 可修改正文。`approved` 和 `archived` 正文永久只读。

### 4.2 `approval_node`

- `code`：节点唯一编码；
- `application_code`：所属申请；
- `approval_round`：所属轮次；
- `sequence`：从 1 开始的顺序；
- `approver_role`：该级固定角色；
- `status`：`waiting | active | approved | rejected | cancelled`；
- `acted_by`、`acted_at`、`comment`：处理信息；
- `version`：乐观版本。

同一申请、轮次和顺序唯一。旧轮次节点不可重置或覆盖。

### 4.3 `approval_record`

系统管理、只追加历史：

- `code`：记录唯一编码；
- `application_code`：所属申请；
- `node_code`：可选审批节点；
- `approval_round`：轮次；
- `action`：`submitted | approved | rejected | withdrawn | archived`；
- `actor_id`、`comment`、`occurred_at`：操作者、说明和时间。

任何审批状态变化都必须追加记录。审批记录不提供更新或删除命令。

### 4.4 `file_version`

- `code`：文件版本唯一编码；
- `owner_type`：`application | certificate | domain_document`；
- `owner_code`：所属业务对象稳定编码；
- `business_key`：同一文件版本链稳定键；
- `business_version`：业务版本，同一链内唯一；
- `original_name`：原文件名；
- `relative_path`：应用数据目录内相对路径；
- `sha256`、`size_bytes`：内容摘要和大小；
- `storage_status`：`staged | ready | failed`；
- `stage_token`：不透明临时导入令牌，仅 staged 状态存在；
- `submitted_by`、`staged_at`、`ready_at`、`failure_reason`：处理信息；
- `version`：乐观版本。

业务版本内容不可覆盖。只有 `ready` 版本可参与归档和证照关联。

### 4.5 `certificate`

每行代表一个证照业务版本：

- `code`：版本记录唯一编码；
- `certificate_key`：证照版本链稳定键；
- `business_version`：链内唯一版本；
- `name`、`certificate_no`：名称和证照编号；
- `issued_at`、`expires_at`：签发日和可选到期日；
- `file_version_code`：可选 ready 文件版本；
- `previous_certificate_code`：可选上一版本；
- `status`：`active | expired | superseded`；
- `created_by`：创建人；
- `version`：乐观版本。

续期新增证照版本并将上一 active 版本标记 superseded；旧版本和提醒保留。

### 4.6 `expiry_reminder`

- `code`：提醒唯一编码；
- `certificate_code`：证照版本；
- `expires_at`：生成时固化的到期日；
- `reminder_days`：生成时固化的阈值；
- `reminder_type`：`upcoming | expired`；
- `status`：`pending | acknowledged`；
- `created_at_business`：业务生成时间；
- `acknowledged_by`、`acknowledged_at`：确认信息；
- `version`：乐观版本。

`certificate_code + expires_at + reminder_days + reminder_type` 唯一，重复刷新不新增记录。

## 5. 申请与审批流程

```text
draft -> approving -> approved -> archived
             |             
             +-> rejected -> draft -> approving (new round)
             +-> withdrawn -> draft -> approving (new round)
```

领域命令：

- `createApplication`：申请人创建本人草稿；
- `updateDraftApplication`：仅申请人修改 draft；
- `submitApplication`：仅 draft 可提交，`approval_round + 1`，按配置新增节点，第一个 active；
- `approveCurrentNode`：当前节点角色批准；中间节点批准后激活下一节点，最后节点批准后申请变为 approved；
- `rejectCurrentNode`：当前节点角色驳回申请，当前节点 rejected，后续 waiting 节点 cancelled；
- `withdrawApplication`：申请人在 approving 状态撤回，active/waiting 节点 cancelled；
- `reviseApplication`：申请人在 rejected/withdrawn 状态将申请转回 draft 后修改；
- `archiveApplication`：归档管理员在至少存在一个 ready 申请文件版本时将 approved 申请归档。

每次重新提交创建新节点，不修改旧轮次节点和记录。已批准、已归档申请不能撤回或重新提交。

## 6. 审批完成桥接

最终节点批准前依次调用 `approvalCompletionHandlers`。处理器只获得冻结的批准 DTO 和类型化 `DomainCommandBus.invoke(commandId, payload)`，不获得 SQLite 连接、任意 SQL 或文件系统句柄。

桥接命令总线由运行时绑定当前 SQLite 事务。任一处理器失败时，最终节点、申请 approved 状态、审批记录、桥接领域写入和审计全部回滚。

用途：

- 库存领用：批准后调用库存扣减命令；拒绝、撤回和处理器失败不改变库存；
- 项目立项/交付：批准后调用项目领域命令或解除关闭阻断；
- 其他领域：只允许调用显式注册的命令 ID。

## 7. 托管文件与恢复协议

渲染器不能直接传入任意源路径。系统文件选择器把文件复制到应用临时导入区，并返回不透明 `stage_token`、原文件名、大小和 SHA-256。

导入流程：

1. `registerStagedFile` 在 SQLite 事务中校验 owner、版本链和 stage 描述，插入 staged 文件版本及审计；
2. 文件存储服务使用文件版本编码构造不可猜测的相对正式路径，并在同一卷执行原子移动；
3. `finalizeFileVersion` 在新 SQLite 事务中重新计算正式文件 SHA-256/大小，匹配后将状态改为 ready；
4. 摘要不匹配或文件缺失时标记 failed，保存非敏感失败原因；
5. 只有 ready 文件可被 `archiveApplication` 或证照引用。

`recoverStagedFiles` 在启动或手动执行：

- 临时文件存在：重试移动和校验；
- 正式文件存在且哈希匹配：完成 ready；
- 两者都不存在或摘要不匹配：标记 failed；
- 重复恢复幂等，不覆盖正式文件。

正式相对路径和 stage token 必须通过严格格式校验，不能包含绝对路径、`..` 或重解析点逃逸。备份和恢复必须同时处理 SQLite 与正式归档目录。

## 8. 证照与提醒

- `createCertificate`：归档管理员创建首个证照版本，可关联 ready 文件；
- `renewCertificate`：新增业务版本，校验日期和版本链，将上一 active 版本 superseded；
- `refreshExpiryReminders(today)`：使用严格日期和配置阈值，幂等创建 upcoming/expired 提醒，并把到期 active 证照标记 expired；
- `acknowledgeReminder`：归档管理员确认 pending 提醒；
- 当前日期等于到期日时视为 expired；
- 无到期日证照不生成提醒。

提醒不触发或声称外部消息送达。

## 9. 角色与错误顺序

- `application_applicant`：本人草稿、提交、撤回、修订和附件导入；
- `application_reviewer`：第 1 级节点；
- `application_compliance_reviewer`：第 2 级节点；
- `application_archive_manager`：第 3 级节点、归档、文件恢复、证照和提醒；
- `application_admin`：查看全部数据、配置和恢复诊断。

写命令顺序：权限、读取对象、身份/归属、状态、领域条件、版本、条件 SQL、审批记录/关联写入、审计。未授权身份不能通过状态或版本错误探测业务状态。

## 10. UI 与动态汇总

UI 描述符只包含纯数据：

- 申请详情：审批节点、审批记录、附件版本；
- 证照详情：历史版本、文件版本、到期提醒；
- 操作组：提交、批准、驳回、撤回、修订、归档、续期、提醒确认、文件恢复；
- 仪表盘：待当前角色审批、待归档申请、临近到期证照、已到期证照、待确认提醒、failed/staged 文件版本。

动态汇总使用注入时钟和当前 SQLite 状态，不用静态蓝图过滤冒充日期指标。

## 11. 公开扩展点

- `application.fields`、`application.relations`、`application.detail.tabs`、`application.create.sources`；
- `file_version.fields`、`file_version.relations`；
- `certificate.fields`、`certificate.relations`、`certificate.detail.tabs`；
- 审批完成处理器和类型化领域命令总线注册接口。

桥接包不能直接修改申请、审批节点、文件状态、证照或提醒。

## 12. 确定性种子

```ts
generateApplicationArchiveSeed({ seed, applicationCount, certificateCount })
```

- seed 为无符号 32 位整数，使用固定基准时间和 xorshift32；
- 覆盖 draft、approving、approved、rejected、withdrawn、archived；
- 包含驳回/撤回后新轮次，节点和审批记录可重放到最终状态；
- 包含 failed 旧文件版本、ready 新版本、证照续期和两种提醒状态；
- 文件摘要、大小和相对路径为合成元数据，不依赖真实文件；
- 不包含真实企业、个人、证照号码或申请内容。

## 13. 验收标准

1. 六实体、五角色、目录、蓝图片段和生产插件通过严格校验；
2. 六实体通用创建和更新全部拒绝；
3. 1–3 级顺序审批、角色和当前节点校验正确；
4. 驳回、撤回、修订和重新提交生成新轮次且旧历史不变；
5. 审批记录只追加；
6. 最终批准处理器与审批状态、桥接写入和审计同事务回滚；
7. stage token、相对路径、重解析点和摘要校验阻止路径逃逸及内容替换；
8. staged/ready/failed 和中断恢复在真实临时目录中幂等；
9. 文件业务版本不可覆盖，正式文件不可静默替换；
10. 申请仅能使用 ready 文件归档，归档后正文只读；
11. 证照续期保留旧版本并更新上一版本状态；
12. 到期边界、提醒唯一性和确认状态正确；
13. UI、动态汇总和全部固定插件贡献通过精确断言；
14. 确定性种子的审批轮次、时间、文件、证照和提醒一致；
15. 完整磁盘桥接包覆盖公开扩展点并通过最终蓝图验证；
16. 领域包、蓝图、桌面运行时、文件验收和 PowerShell 总回归全部通过；
17. 仓库不包含临时文件、SQLite、日志、安装包或敏感凭据。
