import { AlertTriangle, ArrowRight, Boxes, RefreshCw } from 'lucide-react';

import type { RuntimeModule } from '../../shared/blueprint';
import { buildDashboardModel, type DashboardState } from '../dashboard-model';
import { StatusView } from './StatusView';

interface DashboardProps {
  readonly state: DashboardState;
  readonly modules: readonly RuntimeModule[];
  readonly onRefresh: () => void;
  readonly onNavigate: (moduleId: string) => void;
}

export function Dashboard({ state, modules, onRefresh, onNavigate }: DashboardProps) {
  if (state.status === 'loading') return <StatusView kind="loading" title="正在加载仪表盘" />;
  if (state.status === 'error') return (
    <section className="dashboard-error" aria-label="仪表盘加载失败">
      <StatusView kind="error" title="仪表盘加载失败，请检查数据后重试" />
      <button className="secondary-button" type="button" onClick={onRefresh}>
        <RefreshCw size={16} aria-hidden="true" />重试
      </button>
    </section>
  );
  const model = buildDashboardModel(state.snapshot);
  const modulesById = new Map(modules.map((module) => [module.id, module]));
  return (
    <section className="dashboard-workspace">
      <div className="section-heading dashboard-heading">
        <div><h2>运维总览</h2><p>当前离线业务数据的运行摘要</p></div>
        <button className="icon-button" type="button" title="刷新仪表盘" aria-label="刷新仪表盘" onClick={onRefresh}>
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      <section className="dashboard-section metrics-region" aria-label="核心指标">
        <h3>核心指标</h3>
        <div className="metric-grid">
          {model.metrics.map((metric) => (
            <article className={`metric metric-${metric.tone}`} key={metric.id}>
              <span>{metric.name}</span><strong>{metric.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-section status-region" aria-label="状态概览">
          <h3>状态概览</h3>
          {model.statusGroups.length === 0 ? <p className="dashboard-empty">暂无可查看的业务状态</p> :
            model.statusGroups.map((group) => (
              <div className="status-group" data-dashboard-section={group.sectionId} key={`${group.sectionId}:${group.id}`}>
                <div className="dashboard-group-title"><strong>{group.sectionLabel}</strong><span>{group.label}</span></div>
                <div className="status-list">
                  {group.items.map((item) => (
                    <div className="status-row" key={item.id}>
                      <div className="status-label"><span>{item.label}</span><strong>{item.value}</strong></div>
                      <div className="status-track" aria-label={`${item.label} ${item.value}`}>
                        <span className={`status-fill status-fill-${item.tone}`} style={{ width: `${item.ratio * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </section>

        <section className="dashboard-section attention-region" aria-label="待办工作">
          <h3>待办工作</h3>
          {model.attentionEmpty ? <p className="dashboard-empty">没有需要立即处理的业务事项。</p> :
            <div className="attention-list">
              {model.attentionItems.map((item) => {
                const target = item.moduleId ? modulesById.get(item.moduleId) : undefined;
                return (
                  <div className={`attention-row attention-${item.tone}`} key={`${item.sectionId}:${item.id}`}>
                    <AlertTriangle size={17} aria-hidden="true" />
                    <div><strong>{item.label}</strong><span>{item.sectionLabel}</span></div>
                    <b>{item.value}</b>
                    {target ? <button className="icon-button attention-link" type="button" title={`查看${target.name}`} aria-label={`查看${target.name}`} onClick={() => onNavigate(target.id)}><ArrowRight size={16} aria-hidden="true" /></button> : null}
                  </div>
                );
              })}
            </div>}
        </section>
      </div>

      <section className="dashboard-section entry-region" aria-label="业务入口">
        <h3>业务入口</h3>
        <div className="entry-grid">
          {modules.map((module) => (
            <button className="entry-button" type="button" key={module.id} onClick={() => onNavigate(module.id)} aria-label={`查看${module.name}`}>
              <Boxes size={17} aria-hidden="true" /><span>{module.name}</span><ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
