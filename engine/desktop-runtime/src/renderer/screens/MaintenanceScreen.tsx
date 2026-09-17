import { DatabaseBackup, RotateCcw } from 'lucide-react';

export function MaintenanceScreen() {
  return (
    <section>
      <div className="section-heading"><div><h2>数据与备份</h2><p>维护当前用户的离线数据库</p></div></div>
      <div className="maintenance-actions">
        <button className="secondary-button"><DatabaseBackup size={17} />创建备份</button>
        <button className="secondary-button"><RotateCcw size={17} />检查恢复文件</button>
      </div>
    </section>
  );
}
