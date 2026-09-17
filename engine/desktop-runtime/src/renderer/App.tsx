import { useEffect, useState } from 'react';

import type { RuntimeModule } from '../shared/blueprint';
import type { ActorDto } from '../shared/dto';
import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { LoginScreen } from './screens/LoginScreen';
import { MaintenanceScreen } from './screens/MaintenanceScreen';
import { ModuleScreen } from './screens/ModuleScreen';
import { unwrap } from './utils';

interface Metadata {
  readonly software: { readonly name: string };
  readonly modules: readonly RuntimeModule[];
}

interface LoginResult {
  readonly token: string;
  readonly actor: ActorDto;
  readonly expiresAt: string;
}

interface Metric {
  readonly id: string;
  readonly name: string;
  readonly value: number | string;
  readonly tone?: string;
}

export function App() {
  const [session, setSession] = useState<LoginResult | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [selected, setSelected] = useState('');
  const [metrics, setMetrics] = useState<readonly Metric[]>([]);

  async function login(username: string, password: string) {
    const next = unwrap<LoginResult>(await window.businessApi.session.login(username, password));
    setSession(next);
    const info = unwrap<Metadata>(await window.businessApi.metadata.read(next.token));
    setMetadata(info);
    setSelected(info.modules[0]?.id ?? 'dashboard');
  }

  useEffect(() => {
    if (!session || selected !== 'dashboard') return;
    void window.businessApi.dashboard.read(session.token)
      .then((result) => setMetrics(unwrap<readonly Metric[]>(result)))
      .catch(() => setMetrics([]));
  }, [session, selected]);

  async function logout() {
    if (session) await window.businessApi.session.logout(session.token);
    setSession(null); setMetadata(null); setSelected(''); setMetrics([]);
  }

  if (!session || !metadata) return <LoginScreen onLogin={login} />;
  const module = metadata.modules.find((item) => item.id === selected);
  return (
    <AppShell
      softwareName={metadata.software.name}
      userName={session.actor.displayName}
      modules={metadata.modules}
      selected={selected}
      onSelect={setSelected}
      onLogout={() => void logout()}
    >
      {selected === 'dashboard' ? <Dashboard metrics={metrics} />
        : selected === 'maintenance' ? <MaintenanceScreen />
          : module ? <ModuleScreen token={session.token} module={module} />
            : <Dashboard metrics={metrics} />}
    </AppShell>
  );
}
