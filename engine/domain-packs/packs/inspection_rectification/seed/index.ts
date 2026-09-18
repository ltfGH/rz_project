import type { InspectionItemResult, InspectionTaskStatus } from '../runtime/types';

export interface InspectionSeedOptions { readonly seed: number; readonly planCount: number; readonly taskCount: number }
interface PlanRecord { code: string; name: string; cycle_days: number; instructions: string; active: true }
interface TaskRecord { code: string; plan_code: string; title: string; status: InspectionTaskStatus; executor_id: string; scheduled_at: string; started_at: string | null; submitted_at: string | null; archived_at: string | null }
interface ItemRecord { code: string; task_code: string; name: string; standard: string; result: InspectionItemResult; finding: string | null; disposition: string | null; checked_at: string | null }
interface EventRecord { code: string; task_code: string; event_type: 'created' | 'started' | 'item_recorded' | 'submitted' | 'archived'; from_status: InspectionTaskStatus | null; to_status: InspectionTaskStatus; actor_id: string; content: string; occurred_at: string }
export interface InspectionSeed { readonly records: Readonly<{ inspection_plan: readonly Readonly<PlanRecord>[]; inspection_task: readonly Readonly<TaskRecord>[]; inspection_item: readonly Readonly<ItemRecord>[]; inspection_event: readonly Readonly<EventRecord>[] }> }

const STATES = Object.freeze(['pending', 'executing', 'pending_review', 'archived'] as const);
const ITEM_NAMES = Object.freeze(['运行状态', '环境温度', '连接状态', '安全防护', '现场整洁', '标识完整']);
const BASE = Date.parse('2025-01-01T00:00:00.000Z');
function integer(value: number, name: string, min: number, max: number) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`); }
function randomFor(seed: number) { let state = seed >>> 0; if (state === 0) state = 0x9e3779b9; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x1_0000_0000; }; }
function code(prefix: string, index: number) { return `${prefix}-${String(index + 1).padStart(4, '0')}`; }
function iso(value: number) { return new Date(value).toISOString(); }
function freeze<T extends object>(values: T[]) { return Object.freeze(values.map((value) => Object.freeze(value))); }

export function generateInspectionSeed(options: InspectionSeedOptions): InspectionSeed {
  integer(options.seed, 'seed', 0, 0xffff_ffff); integer(options.planCount, 'planCount', 1, 50); integer(options.taskCount, 'taskCount', 4, 10_000);
  const random = randomFor(options.seed); const plans: PlanRecord[] = []; const tasks: TaskRecord[] = []; const items: ItemRecord[] = []; const events: EventRecord[] = [];
  for (let index = 0; index < options.planCount; index += 1) plans.push({ code: code('IPLAN', index), name: `巡检计划-${String(index + 1).padStart(2, '0')}`, cycle_days: 1 + Math.floor(random() * 30), instructions: '按检查项逐项执行并记录', active: true });
  let itemIndex = 0; let eventIndex = 0; const dayOffset = (options.seed >>> 0) % 365;
  const event = (taskCode: string, type: EventRecord['event_type'], from: InspectionTaskStatus | null, to: InspectionTaskStatus, actor: string, content: string, time: number) => events.push({ code: code('IEVT', eventIndex++), task_code: taskCode, event_type: type, from_status: from, to_status: to, actor_id: actor, content, occurred_at: iso(time) });
  for (let index = 0; index < options.taskCount; index += 1) {
    const status = STATES[index % 4]!; const rank = STATES.indexOf(status); const taskCode = code('ITASK', index); const executor = `执行岗位-${String(1 + index % 8).padStart(2, '0')}`; const created = BASE + (dayOffset + index) * 86_400_000; const started = created + 3_600_000; const submitted = created + 7_200_000; const archived = created + 10_800_000;
    tasks.push({ code: taskCode, plan_code: plans[Math.floor(random() * plans.length)]!.code, title: `巡检任务-${String(index + 1).padStart(3, '0')}`, status, executor_id: executor, scheduled_at: iso(created + 1_800_000), started_at: rank >= 1 ? iso(started) : null, submitted_at: rank >= 2 ? iso(submitted) : null, archived_at: rank >= 3 ? iso(archived) : null });
    event(taskCode, 'created', null, 'pending', `计划岗位-${String(1 + index % 4).padStart(2, '0')}`, '创建任务', created);
    if (rank >= 1) event(taskCode, 'started', 'pending', 'executing', executor, '开始巡检', started);
    const count = 2 + Math.floor(random() * 5);
    for (let item = 0; item < count; item += 1) {
      const completed = rank >= 2; const abnormal = completed && random() < 0.3; const result: InspectionItemResult = completed ? (abnormal ? 'abnormal' : 'normal') : 'pending'; const checked = completed ? started + (item + 1) * 300_000 : null;
      items.push({ code: code('IITEM', itemIndex++), task_code: taskCode, name: `${ITEM_NAMES[item % ITEM_NAMES.length]}-${item + 1}`, standard: '符合离线巡检标准', result, finding: abnormal ? '发现合成异常' : null, disposition: abnormal ? '完成现场处置并记录' : null, checked_at: checked === null ? null : iso(checked) });
      if (completed) event(taskCode, 'item_recorded', 'executing', 'executing', executor, result, checked!);
    }
    if (rank >= 2) event(taskCode, 'submitted', 'executing', 'pending_review', executor, '提交复核', submitted);
    if (rank >= 3) event(taskCode, 'archived', 'pending_review', 'archived', `复核岗位-${String(1 + index % 3).padStart(2, '0')}`, '复核归档', archived);
  }
  return Object.freeze({ records: Object.freeze({ inspection_plan: freeze(plans), inspection_task: freeze(tasks), inspection_item: freeze(items), inspection_event: freeze(events) }) });
}

export const inspectionSeedDescriptor = Object.freeze({ id: 'inspection_rectification', version: '1.0.0' });
