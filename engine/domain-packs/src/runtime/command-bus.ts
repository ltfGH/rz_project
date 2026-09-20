import { AppError } from '../../../desktop-runtime/src/shared/errors';
import type { JsonValue } from '../shared/types';
import type {
  DomainCommandBus,
  DomainCommandDefinition,
  DomainCommandExecutionContext,
  JsonObject
} from './types';

const MAX_PAYLOAD_BYTES = 64 * 1024;

function validation(message: string): never {
  throw new AppError('VALIDATION_FAILED', message);
}

function normalize(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return validation('Domain command numbers must be finite.');
    return value;
  }
  if (!value || typeof value !== 'object') {
    return validation('Domain command payload must contain JSON data only.');
  }
  if (ancestors.has(value)) {
    return validation('Domain command payload must be acyclic JSON data.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return validation('Domain command payload must be plain JSON data.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return validation('Domain command payload must contain JSON data only.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => normalize(item, ancestors))) as unknown as JsonValue;
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
        return validation('Domain command payload must be plain JSON data.');
      }
      Object.defineProperty(output, key, {
        value: normalize(descriptor.value, ancestors),
        enumerable: true,
        writable: false,
        configurable: false
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function normalizeObject(payload: JsonObject): JsonObject {
  const normalized = normalize(payload, new Set());
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return validation('Domain command payload must be a JSON object.');
  }
  return normalized;
}

function assertPayloadSize(payload: JsonObject): void {
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    validation('Domain command payload must not exceed 64 KiB.');
  }
}

export class AllowlistedDomainCommandBus implements DomainCommandBus {
  readonly #definitions = new Map<string, DomainCommandDefinition>();
  readonly #context: DomainCommandExecutionContext;

  constructor(
    definitions: readonly DomainCommandDefinition[],
    context: DomainCommandExecutionContext
  ) {
    this.#context = context;
    for (const definition of definitions) {
      if (this.#definitions.has(definition.id)) {
        throw new AppError(
          'BLUEPRINT_INCOMPATIBLE',
          `Domain command '${definition.id}' is already registered.`
        );
      }
      this.#definitions.set(definition.id, definition);
    }
  }

  invoke(commandId: string, payload: JsonObject): JsonValue | void {
    const definition = this.#definitions.get(commandId);
    if (!definition) {
      throw new AppError(
        'BLUEPRINT_INCOMPATIBLE',
        `Domain command '${commandId}' is not registered.`
      );
    }
    if (!definition.allowedSources.includes(this.#context.sourcePluginId)) {
      throw new AppError(
        'PERMISSION_DENIED',
        `Domain command '${commandId}' is not allowed for this source.`
      );
    }

    const normalized = normalizeObject(payload);
    assertPayloadSize(normalized);
    const parsed = normalizeObject(definition.parse(normalized));
    assertPayloadSize(parsed);
    return definition.execute(this.#context, parsed);
  }
}
