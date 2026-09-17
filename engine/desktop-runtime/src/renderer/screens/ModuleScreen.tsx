import { useEffect, useState } from 'react';
import type { RuntimeModule } from '../../shared/blueprint';
import type { EntityRecordDto, PageDto } from '../../shared/dto';
import { DataTable } from '../components/DataTable';
import { StatusView } from '../components/StatusView';
import { unwrap } from '../utils';

export function ModuleScreen({ token, module }: { token: string; module: RuntimeModule }) {
  const [page, setPage] = useState<PageDto<EntityRecordDto> | null>(null);
  const [error, setError] = useState('');
  async function load(keyword = '') {
    setPage(null); setError('');
    try {
      setPage(unwrap<PageDto<EntityRecordDto>>(await window.businessApi.entities.list(
        token, module.entity, { page: 1, pageSize: 20, keyword }
      )));
    } catch { setError('数据加载失败'); }
  }
  useEffect(() => { void load(); }, [module.id]);
  return (
    <section>
      <div className="section-heading"><div><h2>{module.name}</h2><p>查询和维护当前业务记录</p></div></div>
      {error ? <StatusView kind="error" title={error} /> : page ? <DataTable page={page} onSearch={(value) => void load(value)} /> : <StatusView kind="loading" title="正在加载" />}
    </section>
  );
}
