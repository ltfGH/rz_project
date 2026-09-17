import type { EntityRecordDto } from '../../shared/dto';

export function EntityDetail({ record }: { record: EntityRecordDto }) {
  return (
    <dl className="detail-grid">
      {Object.entries(record.values).map(([key, value]) => (
        <div key={key}><dt>{key}</dt><dd>{String(value ?? '')}</dd></div>
      ))}
    </dl>
  );
}
