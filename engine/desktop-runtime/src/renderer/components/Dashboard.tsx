interface Metric { readonly id: string; readonly name: string; readonly value: number | string; readonly tone?: string }

export function Dashboard({ metrics }: { metrics: readonly Metric[] }) {
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
