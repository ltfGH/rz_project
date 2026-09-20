import { AppError } from '../shared/errors';
import type { PluginDescriptor } from './plugin-registry';

export function loadProductionPluginCatalog(catalogPath: string): readonly PluginDescriptor[] {
  let loaded: unknown;
  try {
    loaded = require(catalogPath);
  } catch {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Production plugin catalog could not be loaded.');
  }
  const descriptors = (loaded as { productionPluginDescriptors?: unknown })?.productionPluginDescriptors;
  if (!Array.isArray(descriptors)) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Production plugin catalog export is invalid.');
  }
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== 'object' ||
      typeof (descriptor as PluginDescriptor).id !== 'string' ||
      typeof (descriptor as PluginDescriptor).version !== 'string') {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Production plugin descriptor is invalid.');
    }
  }
  return Object.freeze([...descriptors] as PluginDescriptor[]);
}
