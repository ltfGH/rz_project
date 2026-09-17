export interface AssetSeedOptions {
  readonly seed: number;
  readonly categoryCount: number;
  readonly assetCount: number;
}

export interface AssetCategorySeedRecord {
  readonly code: string;
  readonly name: string;
  readonly active: true;
}

export interface AssetSeedRecord {
  readonly code: string;
  readonly name: string;
  readonly category_code: string;
  readonly status: 'active' | 'maintenance' | 'inactive';
  readonly location: string;
}

export interface AssetResponsibilitySeedRecord {
  readonly code: string;
  readonly asset_code: string;
  readonly assignee: string;
  readonly started_at: string;
  readonly ended_at: null;
  readonly active: true;
}

export interface AssetEventSeedRecord {
  readonly code: string;
  readonly asset_code: string;
  readonly event_type: 'created';
  readonly from_status: null;
  readonly to_status: AssetSeedRecord['status'];
  readonly reason: string;
  readonly occurred_at: string;
}

export interface AssetSeed {
  readonly records: Readonly<{
    asset_category: readonly AssetCategorySeedRecord[];
    asset: readonly AssetSeedRecord[];
    asset_responsibility: readonly AssetResponsibilitySeedRecord[];
    asset_event: readonly AssetEventSeedRecord[];
  }>;
}

const CATEGORY_NAMES = Object.freeze(['生产设备', '检测设备', '办公设备', '辅助设施']);
const ASSET_NAMES = Object.freeze(['控制终端', '采集装置', '检测仪器', '作业设备', '辅助终端']);
const LOCATIONS = Object.freeze(['作业区-A', '作业区-B', '检测区-A', '仓储区-A']);
const STATUSES = Object.freeze(['active', 'maintenance', 'inactive'] as const);
const BASE_TIME = Date.parse('2025-01-01T00:00:00.000Z');

function assertInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function sequenceCode(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)]!;
}

function freezeRecords<T extends object>(records: T[]): readonly Readonly<T>[] {
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

export function generateAssetSeed(options: AssetSeedOptions): AssetSeed {
  assertInteger(options.seed, 'seed', -0x8000_0000, 0xffff_ffff);
  assertInteger(options.categoryCount, 'categoryCount', 1, 100);
  assertInteger(options.assetCount, 'assetCount', 1, 10_000);

  const random = createRandom(options.seed);
  const categoryRecords: AssetCategorySeedRecord[] = [];
  for (let index = 0; index < options.categoryCount; index += 1) {
    categoryRecords.push({
      code: sequenceCode('CAT', index),
      name: `${CATEGORY_NAMES[index % CATEGORY_NAMES.length]}-${String(index + 1).padStart(2, '0')}`,
      active: true
    });
  }

  const assetRecords: AssetSeedRecord[] = [];
  const responsibilityRecords: AssetResponsibilitySeedRecord[] = [];
  const eventRecords: AssetEventSeedRecord[] = [];
  const seedDayOffset = (options.seed >>> 0) % 365;
  for (let index = 0; index < options.assetCount; index += 1) {
    const assetCode = sequenceCode('AST', index);
    const status = pick(STATUSES, random);
    const occurredAt = new Date(
      BASE_TIME + (seedDayOffset + index) * 86_400_000
    ).toISOString();
    assetRecords.push({
      code: assetCode,
      name: `${pick(ASSET_NAMES, random)}-${String(index + 1).padStart(3, '0')}`,
      category_code: categoryRecords[Math.floor(random() * categoryRecords.length)]!.code,
      status,
      location: pick(LOCATIONS, random)
    });
    responsibilityRecords.push({
      code: sequenceCode('RESP', index),
      asset_code: assetCode,
      assignee: `责任岗位-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}`,
      started_at: occurredAt,
      ended_at: null,
      active: true
    });
    eventRecords.push({
      code: sequenceCode('AEVT', index),
      asset_code: assetCode,
      event_type: 'created',
      from_status: null,
      to_status: status,
      reason: '初始化种子数据',
      occurred_at: occurredAt
    });
  }

  return Object.freeze({
    records: Object.freeze({
      asset_category: freezeRecords(categoryRecords),
      asset: freezeRecords(assetRecords),
      asset_responsibility: freezeRecords(responsibilityRecords),
      asset_event: freezeRecords(eventRecords)
    })
  });
}

export const assetSeedDescriptor = Object.freeze({ id: 'asset_registry', version: '1.0.0' });
