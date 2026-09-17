import { Database, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

import type { RuntimeModule } from '../../shared/blueprint';

interface AppShellProps {
  softwareName: string;
  userName: string;
  modules: readonly RuntimeModule[];
  selected: string;
  onSelect(moduleId: string): void;
  onLogout(): void;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand-mark"><Database size={20} /><span>业务工作台</span></div>
        <nav aria-label="主导航">
          <button className={props.selected === 'dashboard' ? 'nav-active' : ''} onClick={() => props.onSelect('dashboard')}>
            <LayoutDashboard size={17} /><span>运维总览</span>
          </button>
          <div className="nav-section-label">业务模块</div>
          {props.modules.map((module) => (
            <button key={module.id} className={props.selected === module.id ? 'nav-active' : ''} onClick={() => props.onSelect(module.id)}>
              <span className="nav-dot" aria-hidden="true" /><span>{module.name}</span>
            </button>
          ))}
          <div className="nav-section-label">系统</div>
          <button className={props.selected === 'maintenance' ? 'nav-active' : ''} onClick={() => props.onSelect('maintenance')}>
            <Settings size={17} /><span>数据与备份</span>
          </button>
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <h1>{props.softwareName}</h1>
          <div className="user-area">
            <span>{props.userName}</span>
            <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={props.onLogout}>
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main>{props.children}</main>
      </section>
    </div>
  );
}
