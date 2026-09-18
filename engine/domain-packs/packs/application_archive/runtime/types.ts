import type{DatabaseSync}from'node:sqlite';
export interface ApplicationActor{userId:number;username:string;displayName:string;roleId:string}
export interface ApplicationConfig{approvalLevels:1|2|3;reminderDays:number}
export interface ApplicationAuditEntry{actor:ApplicationActor;permission:string;entityId:'application'|'approval_node'|'file_version'|'certificate'|'expiry_reminder';recordId:number;result:'success';details:Readonly<Record<string,unknown>>}
export interface DomainCommandBus{invoke(commandId:string,payload:Readonly<Record<string,unknown>>):unknown}
export type ApplicationApprovalCompletionHandler=(application:Readonly<Record<string,unknown>>,bus:DomainCommandBus)=>void;
export interface ApplicationContext{connection:DatabaseSync;actor:ApplicationActor;config:ApplicationConfig;requirePermission:(actor:ApplicationActor,permission:string)=>void;appendAudit:(connection:DatabaseSync,entry:ApplicationAuditEntry)=>void;identityHasRole:(identityId:string,roleId:string,connection:DatabaseSync)=>boolean;approvalCompletionHandlers:readonly ApplicationApprovalCompletionHandler[];commandBus:DomainCommandBus;now:()=>Date;applicationCode:()=>string;nodeCode:()=>string;recordCode:()=>string;fileVersionCode:()=>string;certificateCode:()=>string;reminderCode:()=>string}
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
