import type { DatabaseSync } from 'node:sqlite';

import type {
  PluginContributionSink,
  PluginDescriptor
} from '../../../../desktop-runtime/src/core/plugin-registry';
import { AllowlistedDomainCommandBus } from '../../../src/runtime/command-bus';
import type {
  DomainCommandDefinition,
  DomainCommandExecutionContext,
  JsonObject
} from '../../../src/runtime/types';
import type { ApplicationApprovalCompletionHandler } from '../../application_archive/runtime/types';

const PLUGIN_ID = 'domain_document_bridge';
const COMMAND_ID = 'domain.document.record';

function register(sink: PluginContributionSink, id: string, value: unknown): void {
  sink.register(PLUGIN_ID, id, value);
}

export const domainDocumentApprovalHandler: ApplicationApprovalCompletionHandler = (dto, bus) => {
  bus.invoke(COMMAND_ID, { applicationCode: dto.applicationCode });
};

export function createDomainDocumentCommandBus(connection: DatabaseSync) {
  const definition: DomainCommandDefinition = Object.freeze({
    id: COMMAND_ID,
    allowedSources: Object.freeze([PLUGIN_ID]),
    parse: (payload: JsonObject) => {
      if (typeof payload.applicationCode !== 'string' || !payload.applicationCode.trim()) {
        throw new Error('applicationCode is required');
      }
      return payload;
    },
    execute: (context: DomainCommandExecutionContext, payload: JsonObject) => {
      const now = '2026-09-18T08:00:00.000Z';
      const code = `DOC-${String(payload.applicationCode)}`;
      context.connection.prepare(
        'INSERT INTO biz_domain_document (code,name,version,created_at,updated_at) VALUES (?,?,1,?,?)'
      ).run(code, '批准申请归档', now, now);
    }
  });
  return new AllowlistedDomainCommandBus([definition], Object.freeze({
    connection,
    actor: Object.freeze({
      userId: 0,
      username: PLUGIN_ID,
      displayName: '领域文档桥接',
      roleId: PLUGIN_ID
    }),
    sourcePluginId: PLUGIN_ID
  }));
}

export const domainDocumentRuntimeDescriptor = Object.freeze({
  id: PLUGIN_ID,
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length) throw new Error('unsupported config');
  },
  registerMigrations: (sink) => register(
    sink,
    'domain_document_bridge.v1',
    Object.freeze({ version: 1 })
  ),
  registerServices: (sink) => register(
    sink,
    'domain.document.command',
    Object.freeze({ commandId: COMMAND_ID, approvalHandler: domainDocumentApprovalHandler })
  ),
  registerIpc: () => undefined,
  registerUiExtensions: () => undefined,
  registerAcceptanceScenarios: () => undefined
} satisfies PluginDescriptor);
