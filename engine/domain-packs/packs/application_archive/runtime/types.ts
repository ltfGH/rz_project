import type{DatabaseSync}from'node:sqlite';
export interface ApplicationActor{userId:number;username:string;displayName:string;roleId:string}
export interface ApplicationConfig{approvalLevels:1|2|3;reminderDays:number}
export interface ApplicationAuditEntry{actor:ApplicationActor;permission:string;entityId:'application'|'approval_node'|'file_version'|'certificate'|'expiry_reminder';recordId:number;result:'success';details:Readonly<Record<string,unknown>>}
export interface DomainCommandBus{invoke(commandId:string,payload:Readonly<Record<string,unknown>>):unknown}
export interface ApplicationApprovedDto{readonly applicationId:number;readonly applicationCode:string;readonly applicationType:string;readonly approvalRound:number;readonly applicantId:string}
export type ApplicationApprovalCompletionHandler=(application:ApplicationApprovedDto,bus:DomainCommandBus)=>void;
export interface ArchiveFileInspection{readonly sha256:string;readonly sizeBytes:number}
export interface StagedArchiveFile extends ArchiveFileInspection{readonly stageToken:string;readonly originalName:string}
export interface ArchiveStore{inspectStage(token:string):ArchiveFileInspection|null;readyRelativePath(code:string):string;inspectReady(relativePath:string):ArchiveFileInspection|null;promote(token:string,code:string):Readonly<ArchiveFileInspection&{relativePath:string}>;discardStage(token:string):void}
export interface ApplicationContext{connection:DatabaseSync;actor:ApplicationActor;config:ApplicationConfig;requirePermission:(actor:ApplicationActor,permission:string)=>void;appendAudit:(connection:DatabaseSync,entry:ApplicationAuditEntry)=>void;identityHasRole:(identityId:string,roleId:string,connection:DatabaseSync)=>boolean;approvalCompletionHandlers:readonly ApplicationApprovalCompletionHandler[];commandBus:DomainCommandBus;archiveStore?:ArchiveStore;now:()=>Date;applicationCode:()=>string;nodeCode:()=>string;recordCode:()=>string;fileVersionCode:()=>string;certificateCode:()=>string;reminderCode:()=>string}
export type ApplicationStatus='draft'|'approving'|'approved'|'rejected'|'withdrawn'|'archived';
export interface CreateApplicationRequest{applicationType:string;title:string;content:string}
export interface UpdateDraftApplicationRequest extends CreateApplicationRequest{applicationId:number;expectedVersion:number}
export interface VersionedApplicationRequest{applicationId:number;expectedVersion:number}
export interface SubmitApplicationRequest extends VersionedApplicationRequest{comment:string}
export interface ReviseApplicationRequest extends VersionedApplicationRequest{reason:string}
export interface WithdrawApplicationRequest extends VersionedApplicationRequest{reason:string}
export interface DecideNodeRequest{applicationId:number;expectedApplicationVersion:number;nodeId:number;expectedNodeVersion:number}
export interface ApproveNodeRequest extends DecideNodeRequest{comment:string}
export interface RejectNodeRequest extends DecideNodeRequest{reason:string}
export interface ApplicationResult{applicationId:number;applicationCode:string;status:ApplicationStatus;approvalRound:number;currentNodeCode:string|null;version:number}
export interface RegisterStagedFileRequest{ownerType:'application'|'certificate'|'domain_document';ownerCode:string;businessKey:string;businessVersion:string;staged:StagedArchiveFile}
export interface FinalizeFileVersionRequest{fileVersionId:number;expectedVersion:number}
export interface FileVersionResult{fileVersionId:number;fileVersionCode:string;storageStatus:'staged'|'ready'|'failed';version:number}
export interface ArchiveApplicationRequest{applicationId:number;expectedVersion:number;fileVersionCode:string;comment:string}
export interface CreateCertificateRequest{certificateKey:string;businessVersion:string;name:string;certificateNo:string;issuedAt:string;expiresAt:string|null;fileVersionCode:string|null}
export interface RenewCertificateRequest{previousCertificateId:number;expectedPreviousVersion:number;businessVersion:string;name:string;certificateNo:string;issuedAt:string;expiresAt:string|null;fileVersionCode:string|null}
export interface CertificateResult{certificateId:number;certificateCode:string;certificateKey:string;status:'active'|'expired'|'superseded';version:number}
export interface RefreshExpiryRemindersRequest{today:string}
export interface AcknowledgeReminderRequest{reminderId:number;expectedVersion:number}
export interface ReminderResult{reminderId:number;reminderCode:string;status:'pending'|'acknowledged';version:number}
