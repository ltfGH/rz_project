'use strict';

function validBlueprint() {
  return {
    schemaVersion: '1.0',
    software: {
      id: 'equipment_inspection',
      name: '设备点检管理软件',
      version: '1.0.0',
      purpose: '管理设备点检与异常闭环',
      targetUsers: ['设备管理员'],
      boundaries: ['不连接生产设备'],
      loginMode: 'required'
    },
    archetypes: ['asset_registry', 'inspection_rectification'],
    capabilities: ['entity_crud', 'relationships', 'workflow', 'transactions', 'audit'],
    coverage: { supported: ['设备台账', '点检闭环'], unsupported: [] },
    plugins: [{ id: 'inspection_rectification', config: {} }],
    modules: [{
      id: 'assets',
      name: '设备台账',
      route: 'assets',
      entity: 'asset',
      actions: ['list', 'create', 'update', 'view']
    }],
    entities: [{
      id: 'asset',
      name: '设备',
      retention: 'protected',
      history: false,
      systemManaged: false,
      fields: [
        { id: 'code', name: '设备编码', type: 'text', required: true, unique: true },
        {
          id: 'status',
          name: '状态',
          type: 'enum',
          required: true,
          unique: false,
          options: ['active', 'inactive']
        }
      ],
      relations: []
    }],
    roles: [{
      id: 'admin',
      name: '管理员',
      permissions: ['assets.list', 'assets.create', 'assets.update', 'assets.view']
    }],
    workflows: [],
    dashboards: [],
    demoData: { seed: 20260916, entityMinimums: { asset: 20 } },
    materials: {
      developmentPurpose: '形成可追溯的设备点检记录',
      industry: '企业设备管理',
      technicalFeatures: ['离线运行', 'SQLite 持久化']
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { validBlueprint, clone };
