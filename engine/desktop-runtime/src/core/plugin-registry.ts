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
  readonly domainActions?: PluginContributionSink;
  readonly domainCommands?: PluginContributionSink;
  readonly lifecycleBlockers?: PluginContributionSink;
  readonly completionHandlers?: PluginContributionSink;
  readonly recordActivation?: (pluginId: string) => void;
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
  readonly registerDomainActions?: (registry: PluginContributionSink) => void;
  readonly registerDomainCommands?: (registry: PluginContributionSink) => void;
  readonly registerLifecycleBlockers?: (registry: PluginContributionSink) => void;
  readonly registerCompletionHandlers?: (registry: PluginContributionSink) => void;
}

export interface RuntimeDomainLock {
  readonly dependencyOrder: readonly string[];
  readonly packs: readonly Readonly<{ id: string; version: string }>[];
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
    const selected = new Set<string>();
    for (const selection of selections) {
      if (selected.has(selection.id)) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${selection.id}' is selected more than once.`);
      }
      selected.add(selection.id);
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

  assertLocked(lock: RuntimeDomainLock): void {
    const order = new Set<string>();
    for (const id of lock.dependencyOrder) {
      if (order.has(id)) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Domain lock contains duplicate plugin '${id}'.`);
      }
      order.add(id);
    }
    const packs = new Map<string, string>();
    for (const pack of lock.packs) {
      if (packs.has(pack.id)) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Domain lock contains duplicate pack '${pack.id}'.`);
      }
      packs.set(pack.id, pack.version);
    }
    if (order.size !== packs.size || [...order].some((id) => !packs.has(id))) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Domain lock dependency order does not match its packs.');
    }
    for (const id of order) {
      const descriptor = this.#plugins.get(id);
      if (!descriptor) {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${id}' is not registered.`);
      }
      const version = packs.get(id)!;
      if (descriptor.version !== version) {
        throw new AppError(
          'BLUEPRINT_INCOMPATIBLE',
          `Plugin '${id}' version '${descriptor.version}' does not match locked version '${version}'.`
        );
      }
    }
  }

  activate(
    selections: readonly RuntimePluginSelection[],
    host: RuntimePluginHost,
    activationOrder: readonly string[] = selections.map((selection) => selection.id)
  ): void {
    const selectionsById = new Map(selections.map((selection) => [selection.id, selection]));
    const orderedIds = new Set(activationOrder);
    if (
      orderedIds.size !== activationOrder.length ||
      orderedIds.size !== selectionsById.size ||
      [...orderedIds].some((id) => !selectionsById.has(id))
    ) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Plugin activation order does not match selections.');
    }
    for (const id of activationOrder) {
      const selection = selectionsById.get(id)!;
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
      if (descriptor.registerDomainActions && host.domainActions) {
        descriptor.registerDomainActions(host.domainActions);
      }
      if (descriptor.registerDomainCommands && host.domainCommands) {
        descriptor.registerDomainCommands(host.domainCommands);
      }
      if (descriptor.registerLifecycleBlockers && host.lifecycleBlockers) {
        descriptor.registerLifecycleBlockers(host.lifecycleBlockers);
      }
      if (descriptor.registerCompletionHandlers && host.completionHandlers) {
        descriptor.registerCompletionHandlers(host.completionHandlers);
      }
      host.recordActivation?.(selection.id);
    }
  }
}
