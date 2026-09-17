import { useEffect, useState } from 'react';
import type { RuntimeModule } from '../../shared/blueprint';
import type { AllowedTransitionDto, EntityRecordDto, PageDto } from '../../shared/dto';
import { DataTable } from '../components/DataTable';
import { EntityDetail } from '../components/EntityDetail';
import { StatusView } from '../components/StatusView';
import { WorkflowActions } from '../components/WorkflowActions';
import { unwrap } from '../utils';

export function ModuleScreen({ token, module }: { token: string; module: RuntimeModule }) {
  const [page, setPage] = useState<PageDto<EntityRecordDto> | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EntityRecordDto | null>(null);
  const [actions, setActions] = useState<readonly AllowedTransitionDto[]>([]);
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
  useEffect(() => { setSelected(null); setActions([]); void load(); }, [module.id]);
  return (
    <section>
      <div className="section-heading"><div><h2>{module.name}</h2><p>查询和维护当前业务记录</p></div></div>
      {error ? <StatusView kind="error" title={error} /> : page ? <DataTable page={page} onSearch={(value) => void load(value)} onView={(record) => void view(record)} /> : <StatusView kind="loading" title="正在加载" />}
      {selected && <aside className="detail-drawer" aria-label="记录详情">
        <div className="detail-header"><h3>{String(selected.values.code ?? `记录 ${selected.id}`)}</h3><button className="icon-button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></div>
        <EntityDetail record={selected} />
        <WorkflowActions actions={actions} onExecute={(action) => void execute(action)} />
      </aside>}
    </section>
  );
}
