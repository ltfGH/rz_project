import { AppError } from '../shared/errors';
import type { RuntimePluginSelection } from '../shared/blueprint';

export interface PluginDescriptor {
  readonly id: string;
  readonly version: string;
  readonly blueprintSchemaVersions: readonly string[];
}

export class PluginRegistry {
  readonly #plugins = new Map<string, Readonly<PluginDescriptor>>();

  register(descriptor: PluginDescriptor): void {
    if (this.#plugins.has(descriptor.id)) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${descriptor.id}' is already registered.`);
    }
    this.#plugins.set(descriptor.id, Object.freeze({
      ...descriptor,
      blueprintSchemaVersions: Object.freeze([...descriptor.blueprintSchemaVersions])
    }));
  }

  assertCompatible(selections: readonly RuntimePluginSelection[], schemaVersion: string): void {
    for (const selection of selections) {
      const descriptor = this.#plugins.get(selection.id);
      if (!descriptor) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${selection.id}' is not registered.`);
      }
      if (!descriptor.blueprintSchemaVersions.includes(schemaVersion)) {
        throw new AppError(
          'BLUEPRINT_INCOMPATIBLE',
          `Plugin '${selection.id}' does not support blueprint schema '${schemaVersion}'.`
        );
      }
    }
  }
}
