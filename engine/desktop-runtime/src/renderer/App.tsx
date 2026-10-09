import { useCallback, useEffect, useRef, useState } from 'react';

import type { RuntimeEntity, RuntimeModule } from '../shared/blueprint';
import type { ActorDto, DashboardSnapshotDto, DomainActionDto } from '../shared/dto';
import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import type { DashboardState } from './dashboard-model';
import { LoginScreen } from './screens/LoginScreen';
import { MaintenanceScreen } from './screens/MaintenanceScreen';
import { ModuleScreen } from './screens/ModuleScreen';
import { unwrap } from './utils';

interface Metadata {
  readonly software: { readonly name: string };
  readonly modules: readonly RuntimeModule[];
  readonly entities?: readonly RuntimeEntity[];
  readonly domainActions?: readonly DomainActionDto[];
}

interface LoginResult {
  readonly token: string;
  readonly actor: ActorDto;
  readonly expiresAt: string;
}

export function App() {
  const [session, setSession] = useState<LoginResult | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [selected, setSelected] = useState('');
  const [dashboardState, setDashboardState] = useState<DashboardState>({ status: 'loading' });
  const dashboardRequest = useRef(0);

  async function login(username: string, password: string) {
    const next = unwrap<LoginResult>(await window.businessApi.session.login(username, password));
    setSession(next);
    const info = unwrap<Metadata>(await window.businessApi.metadata.read(next.token));
    setMetadata(info);
    setSelected('dashboard');
  }

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    const request = ++dashboardRequest.current;
    setDashboardState({ status: 'loading' });
    try {
      const result = await window.businessApi.dashboard.read(session.token);
      const snapshot = unwrap<DashboardSnapshotDto>(result);
      if (request === dashboardRequest.current) setDashboardState({ status: 'ready', snapshot });
    } catch {
      if (request === dashboardRequest.current) setDashboardState({ status: 'error' });
    }
  }, [session]);

  useEffect(() => {
    if (!session || selected !== 'dashboard') return;
    void loadDashboard();
  }, [loadDashboard, selected, session]);

  async function logout() {
    if (session) await window.businessApi.session.logout(session.token);
    dashboardRequest.current += 1;
    setSession(null); setMetadata(null); setSelected(''); setDashboardState({ status: 'loading' });
  }

  if (!session || !metadata) return <LoginScreen onLogin={login} />;
  const module = metadata.modules.find((item) => item.id === selected);
  const entity = metadata.entities?.find((item) => item.id === module?.entity);
  return (
    <AppShell
      softwareName={metadata.software.name}
      userName={session.actor.displayName}
      modules={metadata.modules}
      selected={selected}
      onSelect={setSelected}
      onLogout={() => void logout()}
    >
      {selected === 'dashboard' ? <Dashboard state={dashboardState} modules={metadata.modules} onRefresh={() => void loadDashboard()} onNavigate={setSelected} />
        : selected === 'maintenance' ? <MaintenanceScreen token={session.token} />
          : module ? <ModuleScreen token={session.token} module={module} entity={entity} domainActions={metadata.domainActions ?? []} />
            : <Dashboard state={dashboardState} modules={metadata.modules} onRefresh={() => void loadDashboard()} onNavigate={setSelected} />}
    </AppShell>
  );
}
