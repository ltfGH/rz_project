import { Download, Plus, Search } from 'lucide-react';
import type { EntityRecordDto, PageDto } from '../../shared/dto';

export function DataTable({ page, onSearch }: {
  page: PageDto<EntityRecordDto>;
  onSearch(value: string): void;
}) {
  const columns = page.items[0] ? Object.keys(page.items[0].values) : [];
  return (
    <section className="data-region" aria-label="数据列表">
      <div className="list-toolbar" data-ui="list-toolbar">
        <label className="search-box">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">关键词</span>
          <input placeholder="搜索记录" onChange={(event) => onSearch(event.target.value)} />
        </label>
        <div className="toolbar-actions">
          <button className="secondary-button"><Download size={16} />导出</button>
          <button className="primary-button"><Plus size={16} />新增</button>
        </div>
      </div>
      {page.items.length === 0 ? (
        <div className="table-empty" data-state="empty">暂无记录</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>编号</th>{columns.map((column) => <th key={column}>{column}</th>)}<th>操作</th></tr></thead>
            <tbody>{page.items.map((record) => (
              <tr key={record.id}>
                <td>{record.id}</td>
                {columns.map((column) => <td key={column}>{String(record.values[column] ?? '')}</td>)}
                <td><button className="text-button">查看</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <footer className="pagination" data-ui="pagination">
        <span>共 {page.total} 条</span>
        <span>第 {page.page} 页</span>
        <div><button disabled>上一页</button><button disabled>下一页</button></div>
      </footer>
    </section>
  );
}
