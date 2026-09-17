import type { RuntimeField } from '../../shared/blueprint';

export function EntityForm({ fields }: { fields: readonly RuntimeField[] }) {
  return (
    <form className="entity-form">
      {fields.map((field) => (
        <label key={field.id}>
          <span>{field.name}{field.required ? ' *' : ''}</span>
          {field.type === 'enum' ? (
            <select defaultValue=""><option value="" disabled>请选择</option>{field.options?.map((item) => <option key={item}>{item}</option>)}</select>
          ) : field.type === 'boolean' ? (
            <input type="checkbox" />
          ) : (
            <input type={field.type === 'date' ? 'date' : field.type === 'integer' || field.type === 'decimal' ? 'number' : 'text'} />
          )}
        </label>
      ))}
    </form>
  );
}
