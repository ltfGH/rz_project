import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink, PluginDescriptor } from '../../../../desktop-runtime/src/core/plugin-registry';
import { applicationUiDescriptor } from '../ui/index';
import { runApplicationAcceptanceScenario } from '../tests/index';
import { applicationDomainActions } from './action-adapter';
import { ApplicationArchiveService } from './application-service';

export * from './types';
export * from './application-service';
export * from './command-bus';
export * from './archive-store';

const register = (sink: PluginContributionSink, id: string, value: unknown) => (
  sink.register('application_archive', id, value)
);

const ipc = Object.freeze([
  ['application.create', 'createApplication', 'applications.create_application'],
  ['application.update', 'updateDraftApplication', 'applications.update_draft'],
  ['application.submit', 'submitApplication', 'applications.submit'],
  ['application.approve', 'approveCurrentNode', 'applications.approve'],
  ['application.reject', 'rejectCurrentNode', 'applications.reject'],
  ['application.withdraw', 'withdrawApplication', 'applications.withdraw'],
  ['application.revise', 'reviseApplication', 'applications.revise'],
  ['application.archive', 'archiveApplication', 'applications.archive'],
  ['application.summary', 'readApplicationSummary', 'applications.summary'],
  ['application.dashboard_summary', 'readApplicationDashboard', 'applications.summary'],
  ['application.file.register', 'registerStagedFile', 'file_versions.register_staged'],
  ['application.file.finalize', 'finalizeFileVersion', 'file_versions.finalize'],
  ['application.file.recover', 'recoverStagedFiles', 'file_versions.recover'],
  ['application.certificate.create', 'createCertificate', 'certificates.create_certificate'],
  ['application.certificate.renew', 'renewCertificate', 'certificates.renew'],
  ['application.certificate.refresh_reminders', 'refreshExpiryReminders', 'certificates.refresh_reminders'],
  ['application.reminder.acknowledge', 'acknowledgeReminder', 'expiry_reminders.acknowledge']
] as const);

export const applicationRuntimeDescriptor = Object.freeze({
  id: 'application_archive',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    for (const key of Object.keys(config)) {
      if (key !== 'approval_levels' && key !== 'reminder_days') {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Application plugin configuration contains unsupported properties.');
      }
    }
    const levels = config.approval_levels ?? 2;
    const days = config.reminder_days ?? 30;
    if (!Number.isInteger(levels) || Number(levels) < 1 || Number(levels) > 3) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'approval_levels must be an integer from 1 to 3.');
    }
    if (!Number.isInteger(days) || Number(days) < 0 || Number(days) > 365) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'reminder_days must be an integer from 0 to 365.');
    }
  },
  registerMigrations: (sink) => register(
    sink,
    'application_archive.v1',
    Object.freeze({ version: 1, owner: 'application_archive' })
  ),
  registerServices: (sink) => register(
    sink,
    'application.lifecycle',
    Object.freeze({ create: () => new ApplicationArchiveService() })
  ),
  registerIpc: (sink) => {
    for (const [id, method, permission] of ipc) {
      register(sink, id, Object.freeze({ service: 'application.lifecycle', method, permission }));
    }
  },
  registerDomainActions: (sink) => {
    for (const action of applicationDomainActions) register(sink, action.id, action);
  },
  registerUiExtensions: (sink) => {
    for (const extension of applicationUiDescriptor.extensions) register(sink, extension.id, extension);
  },
  registerAcceptanceScenarios: (sink) => register(
    sink,
    'application.lifecycle.acceptance',
    runApplicationAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
