import { composeProduction } from '../../../domain-packs/tests/helpers/production-packs';
import {
  createStandardProject,
  loadStandardTemplateCatalog,
  type StandardProjectRequest,
  type StandardTemplateDescriptor,
  type ThemePresentationProfile
} from '../../src/generator/standard-project';

export const testDigests = Object.freeze({
  dispatcher: 'scrypt$16384$8$1$ZGlzcGF0Y2hlci1zYWx0MQ==$QXkC+g8WOmnKNAtrJeN3u/VUr1oSHxVcbaXJuF8AyuA5VAWwdgvxrpk7xuMHToK0TXjz/gCY7Gbozbov/epFfg==',
  operator: 'scrypt$16384$8$1$b3BlcmF0b3Itc2FsdC0wMQ==$RgRfB1/ZuasinXeYj+agQRjdSxLJLmyUs+4hc7obWE+s4CyE03Kb+Gnm3OQvRDqVL3yNzmc0nYC5MYFzetFgDw==',
  reviewer: 'scrypt$16384$8$1$cmV2aWV3ZXItc2FsdC0wMQ==$E0nzK8Ax/fc6WHYkcKcHp4gRu9IPx/mDI95Y4tcXF5UzqZNTg0bwyjezydD6AxKr/HXr7PjWPTpQ6GKfGiZ6tA==',
  administrator: 'scrypt$16384$8$1$YWRtaW4tc2FsdC0wMDAxMjM0NQ==$zkr0AzJ03NzoUsSpq5N8ZEtBMxwLhmSnKpSDvQr84EqcBJVDlkrJwQXr8LBN5cJ83EwNbwojZoA/47Bx8r1aLw=='
});

export function standardRequest(templateId: string, profile?: Partial<ThemePresentationProfile>): StandardProjectRequest {
  return {
    templateId,
    appId: '11111111-2222-4333-8444-555555555555',
    software: {
      id: `generated_${templateId}`.slice(0, 63), name: 'Campus Operations Software', version: '1.0.0',
      purpose: 'Manage verified offline operations.', targetUsers: ['Operator'],
      boundaries: ['Offline desktop'], loginMode: 'required'
    },
    profile: {
      softwareName: 'Campus Operations Software', purpose: 'Manage verified offline operations.',
      industry: 'Campus operations', entityAliases: {}, moduleAliases: {}, seedVocabulary: {}, ...profile
    },
    passwordDigests: testDigests,
    seed: { value: 20260921, businessRows: 1000, baseline: '2026-09-21T00:00:00.000Z' }
  };
}

export function builtTemplate(descriptor: StandardTemplateDescriptor, request = standardRequest(descriptor.id)) {
  const composition = composeProduction(descriptor.packs.map((pack) => pack.id));
  if (!composition.blueprint) throw new Error(composition.summary);
  return createStandardProject(request, loadStandardTemplateCatalog(), composition.blueprint as any);
}
