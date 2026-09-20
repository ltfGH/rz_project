import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';
import { ApplicationArchiveService } from './application-service';
import type {
  ApplicationApprovalCompletionHandler,
  ApplicationContext,
  ArchiveStore
} from './types';

function context(source: PluginActionContext): ApplicationContext {
  const common = {
    connection: source.connection,
    actor: source.actor,
    config: {
      approvalLevels: Number(source.pluginConfig('application_archive').approval_levels ?? 2) as 1 | 2 | 3,
      reminderDays: Number(source.pluginConfig('application_archive').reminder_days ?? 30)
    },
    requirePermission: source.requirePermission,
    appendAudit: (connection: typeof source.connection, entry: Parameters<ApplicationContext['appendAudit']>[1]) => source.appendAudit(connection, entry),
    identityHasRole: source.identityHasRole,
    approvalCompletionHandlers: source.extensions.values<ApplicationApprovalCompletionHandler>('application.approval.handlers'),
    commandBus: source.commandBus,
    now: source.now,
    applicationCode: () => source.nextCode('application'),
    nodeCode: () => source.nextCode('approval_node'),
    recordCode: () => source.nextCode('approval_record'),
    fileVersionCode: () => source.nextCode('file_version'),
    certificateCode: () => source.nextCode('certificate'),
    reminderCode: () => source.nextCode('expiry_reminder')
  };
  return source.archiveStore === undefined
    ? common
    : { ...common, archiveStore: source.archiveStore as ArchiveStore };
}

export const applicationDomainActions = createServiceActions(
  new ApplicationArchiveService(),
  context,
  [
    { id: 'application.create', method: 'createApplication', permission: 'applications.create_application' },
    { id: 'application.update', method: 'updateDraftApplication', permission: 'applications.update_draft' },
    { id: 'application.submit', method: 'submitApplication', permission: 'applications.submit' },
    { id: 'application.approve', method: 'approveCurrentNode', permission: 'applications.approve' },
    { id: 'application.reject', method: 'rejectCurrentNode', permission: 'applications.reject' },
    { id: 'application.withdraw', method: 'withdrawApplication', permission: 'applications.withdraw' },
    { id: 'application.revise', method: 'reviseApplication', permission: 'applications.revise' },
    { id: 'application.archive', method: 'archiveApplication', permission: 'applications.archive' },
    { id: 'application.summary', method: 'readApplicationSummary', permission: 'applications.summary', idField: 'applicationId' },
    { id: 'application.dashboard_summary', method: 'readApplicationDashboard', permission: 'applications.summary', invocation: 'context' },
    { id: 'application.file.register', method: 'registerStagedFile', permission: 'file_versions.register_staged' },
    { id: 'application.file.finalize', method: 'finalizeFileVersion', permission: 'file_versions.finalize' },
    { id: 'application.file.recover', method: 'recoverStagedFiles', permission: 'file_versions.recover', invocation: 'context' },
    { id: 'application.certificate.create', method: 'createCertificate', permission: 'certificates.create_certificate' },
    { id: 'application.certificate.renew', method: 'renewCertificate', permission: 'certificates.renew' },
    { id: 'application.certificate.refresh_reminders', method: 'refreshExpiryReminders', permission: 'certificates.refresh_reminders' },
    { id: 'application.reminder.acknowledge', method: 'acknowledgeReminder', permission: 'expiry_reminders.acknowledge' }
  ]
);
