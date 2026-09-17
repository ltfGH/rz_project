import { DatabaseBackup } from 'lucide-react';
import { useState } from 'react';
import { unwrap } from '../utils';

export function MaintenanceScreen({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  async function backup() {
    setMessage('正在创建备份');
    try {
      const result = unwrap<{ fileName: string }>(await window.businessApi.maintenance.backup(token));
      setMessage(`备份已创建：${result.fileName}`);
    } catch { setMessage('备份创建失败'); }
  }
  return (
    <section>
      <div className="section-heading"><div><h2>数据与备份</h2><p>维护当前用户的离线数据库</p></div></div>
      <div className="maintenance-actions">
        <button className="secondary-button" onClick={() => void backup()}><DatabaseBackup size={17} />创建备份</button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
