import { AppError } from '../shared/errors';
import type { JsonValue, RuntimePluginSelection } from '../shared/blueprint';

export interface PluginContributionSink {
  register(pluginId: string, contributionId: string, contribution: unknown): void;
}

export interface RuntimePluginHost {
  readonly migrations: PluginContributionSink;
  readonly services: PluginContributionSink;
  readonly ipc: PluginContributionSink;
  readonly uiExtensions: PluginContributionSink;
  readonly acceptanceScenarios: PluginContributionSink;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly version: string;
  readonly blueprintSchemaVersions: readonly string[];
  readonly validateConfig: (config: Readonly<Record<string, JsonValue>>) => void;
  readonly registerMigrations: (registry: PluginContributionSink) => void;
  readonly registerServices: (registry: PluginContributionSink) => void;
  readonly registerIpc: (registry: PluginContributionSink) => void;
  readonly registerUiExtensions: (registry: PluginContributionSink) => void;
  readonly registerAcceptanceScenarios: (registry: PluginContributionSink) => void;
}

const REQUIRED_HOOKS = Object.freeze([
  'validateConfig',
  'registerMigrations',
  'registerServices',
  'registerIpc',
  'registerUiExtensions',
  'registerAcceptanceScenarios'
] as const);

export class PluginRegistry {
  readonly #plugins = new Map<string, Readonly<PluginDescriptor>>();

  register(descriptor: PluginDescriptor): void {
    if (this.#plugins.has(descriptor.id)) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${descriptor.id}' is already registered.`);
    }
    for (const hook of REQUIRED_HOOKS) {
      if (typeof descriptor[hook] !== 'function') {
        throw new AppError(
          'BLUEPRINT_INCOMPATIBLE',
          `Plugin '${descriptor.id}' is missing required hook '${hook}'.`
        );
      }
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
      descriptor.validateConfig(selection.config);
    }
  }

  activate(selections: readonly RuntimePluginSelection[], host: RuntimePluginHost): void {
    for (const selection of selections) {
      const descriptor = this.#plugins.get(selection.id);
      if (!descriptor) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${selection.id}' is not registered.`);
      }
      descriptor.validateConfig(selection.config);
      descriptor.registerMigrations(host.migrations);
      descriptor.registerServices(host.services);
      descriptor.registerIpc(host.ipc);
      descriptor.registerUiExtensions(host.uiExtensions);
      descriptor.registerAcceptanceScenarios(host.acceptanceScenarios);
    }
  }
}
