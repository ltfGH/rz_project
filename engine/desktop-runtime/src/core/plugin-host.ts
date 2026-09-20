import { AppError } from '../shared/errors';
import type { PluginContributionSink, RuntimePluginHost } from './plugin-registry';

export interface PluginContribution {
  readonly pluginId: string;
  readonly id: string;
  readonly value: unknown;
}

export interface ActivatedPluginHost {
  readonly activationOrder: readonly string[];
  readonly migrations: Readonly<Record<string, PluginContribution>>;
  readonly services: Readonly<Record<string, PluginContribution>>;
  readonly ipc: Readonly<Record<string, PluginContribution>>;
  readonly uiExtensions: Readonly<Record<string, PluginContribution>>;
  readonly acceptanceScenarios: Readonly<Record<string, PluginContribution>>;
  readonly domainActions: Readonly<Record<string, PluginContribution>>;
  readonly domainCommands: Readonly<Record<string, PluginContribution>>;
  readonly lifecycleBlockers: Readonly<Record<string, PluginContribution>>;
  readonly completionHandlers: Readonly<Record<string, PluginContribution>>;
}

class ContributionRegistry implements PluginContributionSink {
  readonly #entries = new Map<string, PluginContribution>();
  #frozen = false;

  register(pluginId: string, contributionId: string, value: unknown): void {
    if (this.#frozen) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Plugin contribution registry is frozen.');
    }
    if (this.#entries.has(contributionId)) {
      throw new AppError(
        'BLUEPRINT_INCOMPATIBLE',
        `Plugin contribution '${contributionId}' is already registered.`
      );
    }
    this.#entries.set(contributionId, Object.freeze({
      pluginId,
      id: contributionId,
      value
    }));
  }

  freeze(): Readonly<Record<string, PluginContribution>> {
    this.#frozen = true;
    return Object.freeze(Object.fromEntries(this.#entries));
  }
}

export class PluginHost implements RuntimePluginHost {
  readonly migrations = new ContributionRegistry();
  readonly services = new ContributionRegistry();
  readonly ipc = new ContributionRegistry();
  readonly uiExtensions = new ContributionRegistry();
  readonly acceptanceScenarios = new ContributionRegistry();
  readonly domainActions = new ContributionRegistry();
  readonly domainCommands = new ContributionRegistry();
  readonly lifecycleBlockers = new ContributionRegistry();
  readonly completionHandlers = new ContributionRegistry();
  readonly #activationOrder: string[] = [];
  #frozen = false;

  recordActivation = (pluginId: string): void => {
    if (this.#frozen) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Plugin host is frozen.');
    }
    if (this.#activationOrder.includes(pluginId)) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', `Plugin '${pluginId}' was activated more than once.`);
    }
    this.#activationOrder.push(pluginId);
  };

  freeze(): ActivatedPluginHost {
    if (this.#frozen) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Plugin host is already frozen.');
    }
    this.#frozen = true;
    return Object.freeze({
      activationOrder: Object.freeze([...this.#activationOrder]),
      migrations: this.migrations.freeze(),
      services: this.services.freeze(),
      ipc: this.ipc.freeze(),
      uiExtensions: this.uiExtensions.freeze(),
      acceptanceScenarios: this.acceptanceScenarios.freeze(),
      domainActions: this.domainActions.freeze(),
      domainCommands: this.domainCommands.freeze(),
      lifecycleBlockers: this.lifecycleBlockers.freeze(),
      completionHandlers: this.completionHandlers.freeze()
    });
  }
}
