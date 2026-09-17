import { Database, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export function LoginScreen({ onLogin }: { onLogin(username: string, password: string): Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try { await onLogin(username, password); } catch { setError('账号或密码无效'); }
  }
  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-brand"><Database size={24} /><span>离线业务工作台</span></div>
        <h1>登录</h1>
        <label><span>账号</span><input aria-label="账号" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label><span>密码</span><input aria-label="密码" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button login-button" type="submit"><LogIn size={17} />登录</button>
      </form>
    </main>
  );
}
