import type { RuntimeModule } from '../../shared/blueprint';
import type { DashboardState } from '../dashboard-model';
import { StatusView } from './StatusView';

interface DashboardProps {
  readonly state: DashboardState;
  readonly modules: readonly RuntimeModule[];
  readonly onRefresh: () => void;
  readonly onNavigate: (moduleId: string) => void;
}

export function Dashboard({ state }: DashboardProps) {
  if (state.status === 'loading') return <StatusView kind="loading" title="正在加载仪表盘" />;
  if (state.status === 'error') return <StatusView kind="error" title="仪表盘加载失败" />;
  const metrics = state.snapshot.metrics;
  return (
    <section>
      <div className="section-heading"><div><h2>运维总览</h2><p>当前离线数据的业务摘要</p></div></div>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className={`metric metric-${metric.tone ?? 'neutral'}`} key={metric.id}>
            <span>{metric.name}</span><strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <section className="work-band"><h3>待办工作</h3><p>没有需要立即处理的系统任务。</p></section>
    </section>
  );
}
