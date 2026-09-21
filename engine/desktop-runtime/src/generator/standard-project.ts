import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { RuntimeBlueprint, RuntimeRole, RuntimeSoftware } from '../shared/blueprint';

const id = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const displayText = z.string().trim().min(1).max(240);
const jsonRecord = z.record(z.string(), z.json());
const roleSource = z.object({ name: displayText, sources: z.array(id).min(1) }).strict();
const roleProfiles = z.object({
  operations_dispatcher: roleSource,
  operations_operator: roleSource,
  operations_reviewer: roleSource,
  operations_admin: roleSource
}).strict();
const descriptorSchema = z.object({
  id,
  packs: z.array(z.object({ id, version: z.literal('1.0.0'), config: jsonRecord }).strict()).min(1),
  roleProfiles,
  maintenanceEntity: id,
  seed: z.object({
    value: z.number().int().min(0).max(0xffff_ffff),
    targetBusinessRows: z.literal(1000),
    baseline: z.iso.datetime({ offset: false })
  }).strict(),
  coverage: z.array(displayText).min(1),
  materials: z.object({
    developmentPurpose: displayText,
    industry: displayText,
    technicalFeatures: z.array(displayText).min(1)
  }).strict(),
  aliasableEntities: z.array(id).min(1),
  aliasableModules: z.array(id).min(1)
}).strict();
const catalogSchema = z.object({
  catalogVersion: z.literal('1.0'), templates: z.array(descriptorSchema).length(8)
}).strict();
const profileSchema = z.object({
  softwareName: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(240),
  industry: z.string().trim().min(1).max(80),
  entityAliases: z.record(id, z.string().trim().min(1).max(80)),
  moduleAliases: z.record(id, z.string().trim().min(1).max(80)),
  seedVocabulary: z.record(id, z.array(z.string().trim().min(1).max(40)).min(1).max(20))
}).strict();
const digest = z.string().regex(/^scrypt\$16384\$8\$1\$/);
const requestSchema = z.object({
  templateId: id,
  appId: z.string().uuid(),
  software: z.object({
    id, name: displayText, version: z.literal('1.0.0'), purpose: displayText,
    targetUsers: z.array(displayText).min(1), boundaries: z.array(displayText).min(1),
    loginMode: z.literal('required')
  }).strict(),
  profile: profileSchema,
  passwordDigests: z.object({
    dispatcher: digest, operator: digest, reviewer: digest, administrator: digest
  }).strict(),
  seed: z.object({
    value: z.number().int().min(0).max(0xffff_ffff),
    businessRows: z.literal(1000), baseline: z.iso.datetime({ offset: false })
  }).strict()
}).strict();

export type StandardTemplateDescriptor = z.infer<typeof descriptorSchema>;
export type StandardTemplateCatalog = z.infer<typeof catalogSchema>;
export type ThemePresentationProfile = z.infer<typeof profileSchema>;
export type StandardProjectRequest = z.infer<typeof requestSchema>;

export interface StandardProjectConfig {
  id: string;
  appId: string;
  templateId: string;
  software: RuntimeSoftware;
  packs: StandardTemplateDescriptor['packs'];
  systemModules: NonNullable<RuntimeBlueprint['modules']>;
  roleProfiles: readonly RuntimeRole[];
  profile: ThemePresentationProfile;
  seed: StandardProjectRequest['seed'];
  coverage: readonly string[];
  materials: StandardTemplateDescriptor['materials'];
}

function defaultCatalogPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'standard-templates', 'catalog.json'),
    path.resolve(__dirname, '..', '..', '..', 'standard-templates', 'catalog.json')
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Standard template catalog was not found.');
  return found;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function loadStandardTemplateCatalog(filename = defaultCatalogPath()): StandardTemplateCatalog {
  const parsed = catalogSchema.parse(JSON.parse(fs.readFileSync(filename, 'utf8')));
  const ids = parsed.templates.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || ids.join() !== [...ids].sort().join()) {
    throw new Error('Standard template descriptors must have unique sorted ids.');
  }
  for (const entry of parsed.templates) {
    if (new Set(entry.packs.map((pack) => pack.id)).size !== entry.packs.length) {
      throw new Error(`Template '${entry.id}' has duplicate packs.`);
    }
    for (const profile of Object.values(entry.roleProfiles)) {
      if (new Set(profile.sources).size !== profile.sources.length) {
        throw new Error(`Template '${entry.id}' has duplicate role sources.`);
      }
    }
  }
  return deepFreeze(parsed);
}

function validateFinalBlueprint(value: RuntimeBlueprint): void {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'domain-packs', 'src', 'blueprint-validator.ts'),
    path.resolve(__dirname, '..', '..', '..', '..', 'domain-packs', 'src', 'blueprint-validator.ts')
  ];
  const filename = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filename) throw new Error('Domain blueprint validator was not found.');
  const loaded = require(filename) as { validateComposedBlueprint(value: unknown): { canGenerate: boolean; summary: string } };
  const result = loaded.validateComposedBlueprint(value);
  if (!result.canGenerate) throw new Error(result.summary || 'Standard project blueprint validation failed.');
}

function compositeRoles(
  descriptor: StandardTemplateDescriptor,
  roles: readonly RuntimeRole[]
): readonly RuntimeRole[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  return Object.entries(descriptor.roleProfiles).map(([roleId, profile]) => {
    const permissions = new Set<string>();
    for (const sourceId of profile.sources) {
      const source = byId.get(sourceId);
      if (!source) throw new Error(`Template '${descriptor.id}' role source '${sourceId}' is unavailable.`);
      for (const permission of source.permissions) permissions.add(permission);
    }
    if (roleId === 'operations_admin') {
      permissions.add('maintenance.backup');
      permissions.add('maintenance.restore');
    }
    return { id: roleId, name: profile.name, permissions: [...permissions].sort() };
  });
}

export function createStandardProject(
  rawRequest: StandardProjectRequest,
  catalog: StandardTemplateCatalog,
  composedBlueprint: RuntimeBlueprint
): Readonly<{ project: StandardProjectConfig; blueprint: RuntimeBlueprint }> {
  const request = requestSchema.parse(rawRequest);
  const descriptor = catalog.templates.find((entry) => entry.id === request.templateId);
  if (!descriptor) throw new Error(`Standard template '${request.templateId}' is not supported.`);
  const selected = [...(composedBlueprint.plugins ?? [])].map((entry) => entry.id).sort();
  const expected = descriptor.packs.map((entry) => entry.id).sort();
  if (selected.join() !== expected.join()) throw new Error('Composed blueprint packs do not match the standard template.');

  const entityAliases = Object.entries(request.profile.entityAliases);
  for (const [entityId] of entityAliases) {
    if (!descriptor.aliasableEntities.includes(entityId)) throw new Error(`Entity alias '${entityId}' is not allowed.`);
  }
  const moduleAliases = Object.entries(request.profile.moduleAliases);
  for (const [moduleId] of moduleAliases) {
    if (!descriptor.aliasableModules.includes(moduleId)) throw new Error(`Module alias '${moduleId}' is not allowed.`);
  }

  const entities = structuredClone(composedBlueprint.entities ?? []).map((entity) => ({
    ...entity, name: request.profile.entityAliases[entity.id] ?? entity.name
  }));
  if (!entities.some((entity) => entity.id === descriptor.maintenanceEntity)) {
    throw new Error(`Maintenance entity '${descriptor.maintenanceEntity}' is unavailable.`);
  }
  const modules = structuredClone(composedBlueprint.modules ?? []).map((module) => ({
    ...module, name: request.profile.moduleAliases[module.id] ?? module.name
  }));
  const maintenance = {
    id: 'maintenance', name: 'Data and Backup', route: 'maintenance',
    entity: descriptor.maintenanceEntity, actions: ['backup', 'restore']
  } as const;
  if (modules.some((module) => module.id === maintenance.id)) throw new Error('Maintenance module is already present.');
  const profiles = compositeRoles(descriptor, composedBlueprint.roles ?? []);
  const blueprint: RuntimeBlueprint = {
    ...structuredClone(composedBlueprint),
    software: { ...request.software, name: request.profile.softwareName, purpose: request.profile.purpose },
    entities,
    modules: [...modules, maintenance],
    roles: [...structuredClone(composedBlueprint.roles ?? []), ...profiles],
    materials: {
      ...structuredClone(composedBlueprint.materials ?? {}),
      developmentPurpose: request.profile.purpose,
      industry: request.profile.industry,
      technicalFeatures: descriptor.materials.technicalFeatures
    }
  };
  validateFinalBlueprint(blueprint);
  const project: StandardProjectConfig = {
    id: request.software.id,
    appId: request.appId,
    templateId: descriptor.id,
    software: blueprint.software,
    packs: descriptor.packs,
    systemModules: [maintenance],
    roleProfiles: profiles,
    profile: request.profile,
    seed: request.seed,
    coverage: descriptor.coverage,
    materials: descriptor.materials
  };
  return deepFreeze({ project, blueprint });
}
