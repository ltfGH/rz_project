import { AlertTriangle, Inbox, LoaderCircle, ShieldX } from 'lucide-react';

type StatusKind = 'loading' | 'empty' | 'denied' | 'error';

const icons = {
  loading: LoaderCircle,
  empty: Inbox,
  denied: ShieldX,
  error: AlertTriangle
};

export function StatusView({ kind, title }: { kind: StatusKind; title: string }) {
  const Icon = icons[kind];
  return (
    <div className={`status-view status-${kind}`} data-state={kind} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={24} aria-hidden="true" />
      <span>{title}</span>
    </div>
  );
}
