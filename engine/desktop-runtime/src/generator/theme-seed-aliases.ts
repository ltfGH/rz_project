const TARGETS = Object.freeze({
  asset_names: Object.freeze({ entity: 'asset', field: 'name', nullableOnly: false }),
  material_names: Object.freeze({ entity: 'material', field: 'name', nullableOnly: false }),
  project_names: Object.freeze({ entity: 'project', field: 'name', nullableOnly: false }),
  application_titles: Object.freeze({ entity: 'application', field: 'title', nullableOnly: false }),
  inspection_titles: Object.freeze({ entity: 'inspection_task', field: 'title', nullableOnly: false }),
  work_order_titles: Object.freeze({ entity: 'work_order', field: 'title', nullableOnly: false }),
  findings: Object.freeze({ entity: 'inspection_item', field: 'finding', nullableOnly: true })
});

export function applyThemeSeedVocabulary(
  records: Record<string, Array<Record<string, unknown>>>,
  vocabulary: Readonly<Record<string, readonly string[]>>
): void {
  for (const [key, values] of Object.entries(vocabulary)) {
    const target = TARGETS[key as keyof typeof TARGETS];
    if (!target) throw new Error(`Seed vocabulary '${key}' is not supported.`);
    if (values.length === 0) throw new Error(`Seed vocabulary '${key}' is empty.`);
    const rows = records[target.entity] ?? [];
    let index = 0;
    for (const row of rows) {
      if (target.nullableOnly && (row[target.field] === null || row[target.field] === undefined)) continue;
      row[target.field] = `${values[index % values.length]} ${String(index + 1).padStart(3, '0')}`;
      index += 1;
    }
  }
}
