import type { PluginDescriptor } from '../../../desktop-runtime/src/core/plugin-registry';
import { applicationRuntimeDescriptor } from '../../packs/application_archive/runtime/index';
import { assetRuntimeDescriptor } from '../../packs/asset_registry/runtime/index';
import { assetInspectionRuntimeDescriptor } from '../../packs/asset_inspection_bridge/runtime/index';
import { assetWorkOrderRuntimeDescriptor } from '../../packs/asset_work_order_bridge/runtime/index';
import { domainDocumentRuntimeDescriptor } from '../../packs/domain_document_bridge/runtime/index';
import { inspectionRuntimeDescriptor } from '../../packs/inspection_rectification/runtime/index';
import { inventoryRuntimeDescriptor } from '../../packs/inventory_batch/runtime/index';
import { projectRuntimeDescriptor } from '../../packs/project_task/runtime/index';
import { workOrderRuntimeDescriptor } from '../../packs/work_order_service/runtime/index';

export const productionPluginDescriptors: readonly PluginDescriptor[] = Object.freeze([
  applicationRuntimeDescriptor,
  assetInspectionRuntimeDescriptor,
  assetRuntimeDescriptor,
  assetWorkOrderRuntimeDescriptor,
  domainDocumentRuntimeDescriptor,
  inspectionRuntimeDescriptor,
  inventoryRuntimeDescriptor,
  projectRuntimeDescriptor,
  workOrderRuntimeDescriptor
]);
