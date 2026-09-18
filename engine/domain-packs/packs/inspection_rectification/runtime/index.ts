export * from './types';
export * from './inspection-service';

export const inspectionRuntimeDescriptor = Object.freeze({
  id: 'inspection_rectification',
  version: '1.0.0',
  services: Object.freeze(['InspectionService'])
});
