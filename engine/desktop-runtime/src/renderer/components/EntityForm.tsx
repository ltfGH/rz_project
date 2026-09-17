import type { RuntimeField } from '../../shared/blueprint';
import { useState, type FormEvent } from 'react';

export function EntityForm({ fields, initial = {}, onSubmit, onCancel }: {
  fields: readonly RuntimeField[];
  initial?: Readonly<Record<string, unknown>>;
  onSubmit(values: Readonly<Record<string, unknown>>): Promise<void>;
  onCancel(): void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(
    fields.map((field) => [field.id, initial[field.id] ?? (field.type === 'boolean' ? false : '')])
  ));
  const [saving, setSaving] = useState(false);
  function change(field: RuntimeField, value: string | boolean) {
    setValues((current) => ({
      ...current,
      [field.id]: field.type === 'integer' || field.type === 'decimal'
        ? (value === '' ? '' : Number(value))
        : value
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const output = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
      await onSubmit(output);
    } finally { setSaving(false); }
  }
  return (
    <form className="entity-form" onSubmit={submit}>
      {fields.map((field) => (
        <label key={field.id}>
          <span>{field.name}{field.required ? ' *' : ''}</span>
          {field.type === 'enum' ? (
            <select aria-label={field.name} required={field.required} value={String(values[field.id] ?? '')} onChange={(event) => change(field, event.target.value)}><option value="" disabled>请选择</option>{field.options?.map((item) => <option key={item}>{item}</option>)}</select>
          ) : field.type === 'boolean' ? (
            <input aria-label={field.name} type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => change(field, event.target.checked)} />
          ) : (
            <input aria-label={field.name} required={field.required} value={String(values[field.id] ?? '')} onChange={(event) => change(field, event.target.value)} type={field.type === 'date' ? 'date' : field.type === 'integer' || field.type === 'decimal' ? 'number' : 'text'} />
          )}
        </label>
      ))}
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中' : '保存'}</button></div>
    </form>
  );
}
