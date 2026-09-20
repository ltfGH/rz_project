import { useEffect, useState } from 'react';
import type { RuntimeEntity, RuntimeModule } from '../../shared/blueprint';
import type { AllowedTransitionDto, DomainActionDto, EntityRecordDto, PageDto } from '../../shared/dto';
import { DataTable } from '../components/DataTable';
import { EntityDetail } from '../components/EntityDetail';
import { EntityForm } from '../components/EntityForm';
import { StatusView } from '../components/StatusView';
import { WorkflowActions } from '../components/WorkflowActions';
import { DomainActions } from '../components/DomainActions';
import { RelatedRecords } from '../components/RelatedRecords';
import { unwrap } from '../utils';

export function ModuleScreen({ token, module, entity, domainActions }: {
  token: string;
  module: RuntimeModule;
  entity: RuntimeEntity | undefined;
  domainActions: readonly DomainActionDto[];
}) {
  const [page, setPage] = useState<PageDto<EntityRecordDto> | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EntityRecordDto | null>(null);
  const [actions, setActions] = useState<readonly AllowedTransitionDto[]>([]);
  const [editing, setEditing] = useState<'new' | EntityRecordDto | null>(null);
  async function load(keyword = '') {
    setPage(null); setError('');
    try {
      setPage(unwrap<PageDto<EntityRecordDto>>(await window.businessApi.entities.list(
        token, module.entity, { page: 1, pageSize: 20, keyword }
      )));
    } catch { setError('数据加载失败'); }
  }
  async function view(record: EntityRecordDto) {
    const detail = unwrap<EntityRecordDto>(await window.businessApi.entities.get(token, module.entity, record.id));
    const allowed = unwrap<readonly AllowedTransitionDto[]>(
      await window.businessApi.workflows.allowed(token, module.entity, record.id)
    );
    setSelected(detail); setActions(allowed);
  }
  async function execute(action: AllowedTransitionDto) {
    if (!selected) return;
    const updated = unwrap<EntityRecordDto>(await window.businessApi.workflows.execute(token, {
      workflowId: action.workflowId,
      transitionId: action.transitionId,
      recordId: selected.id,
      expectedVersion: selected.version,
      input: {}
    }));
    setSelected(updated);
    setActions(unwrap<readonly AllowedTransitionDto[]>(
      await window.businessApi.workflows.allowed(token, module.entity, updated.id)
    ));
    await load();
  }
  async function save(values: Readonly<Record<string, unknown>>) {
    if (editing === 'new') {
      await window.businessApi.entities.create(token, module.entity, values);
    } else if (editing) {
      const updated = unwrap<EntityRecordDto>(await window.businessApi.entities.update(
        token, module.entity, editing.id, editing.version, values
      ));
      setSelected(updated);
    }
    setEditing(null);
    await load();
  }
  useEffect(() => { setSelected(null); setActions([]); setEditing(null); void load(); }, [module.id]);
  return (
    <section>
      <div className="section-heading"><div><h2>{module.name}</h2><p>查询和维护当前业务记录</p></div></div>
      {error ? <StatusView kind="error" title={error} /> : page ? <DataTable page={page} onSearch={(value) => void load(value)} onView={(record) => void view(record)} onCreate={entity && module.actions.includes('create') ? () => setEditing('new') : undefined} /> : <StatusView kind="loading" title="正在加载" />}
      {selected && <aside className="detail-drawer" aria-label="记录详情">
        <div className="detail-header"><h3>{String(selected.values.code ?? `记录 ${selected.id}`)}</h3><button className="icon-button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></div>
        <EntityDetail record={selected} />
        {entity && <RelatedRecords token={token} entity={entity} record={selected} />}
        <DomainActions token={token} entityId={module.entity} record={selected} actions={domainActions} onComplete={() => void view(selected).then(() => load())} />
        {entity && module.actions.includes('update') && <button className="secondary-button edit-button" onClick={() => setEditing(selected)}>编辑</button>}
        <WorkflowActions actions={actions} onExecute={(action) => void execute(action)} />
      </aside>}
      {editing && entity && <aside className="detail-drawer" aria-label="记录编辑">
        <div className="detail-header"><h3>{editing === 'new' ? `新增${entity.name}` : `编辑${entity.name}`}</h3><button className="icon-button" aria-label="关闭编辑" onClick={() => setEditing(null)}>×</button></div>
        <EntityForm fields={entity.fields} initial={editing === 'new' ? {} : editing.values} onSubmit={save} onCancel={() => setEditing(null)} />
      </aside>}
    </section>
  );
}
