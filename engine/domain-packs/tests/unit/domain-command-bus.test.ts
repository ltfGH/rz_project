import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  AllowlistedDomainCommandBus
} from '../../src/runtime/command-bus';
import type {
  DomainCommandDefinition,
  DomainCommandExecutionContext,
  JsonObject
} from '../../src/runtime/types';

function executionContext(sourcePluginId = 'inventory_application_bridge'): DomainCommandExecutionContext {
  return Object.freeze({
    connection: new DatabaseSync(':memory:'),
    actor: Object.freeze({
      userId: 7,
      username: 'reviewer',
      displayName: '复核人',
      roleId: 'application_reviewer'
    }),
    sourcePluginId
  });
}

function closeContext(context: DomainCommandExecutionContext): void {
  context.connection.close();
}

test('executes an allowed command with parsed null-prototype frozen JSON', () => {
  const context = executionContext();
  let received: Readonly<Record<string, unknown>> | undefined;
  const definition: DomainCommandDefinition = Object.freeze({
    id: 'inventory.application.issue',
    allowedSources: Object.freeze(['inventory_application_bridge']),
    parse: (payload: JsonObject) => {
      assert.deepEqual(Object.keys(payload), ['quantity']);
      assert.equal(payload.quantity, 2);
      return payload;
    },
    execute: (_context: DomainCommandExecutionContext, payload: JsonObject) => {
      received = payload;
      return Object.freeze({ issued: Number(payload.quantity) });
    }
  });

  try {
    const bus = new AllowlistedDomainCommandBus([definition], context);
    assert.deepEqual(bus.invoke('inventory.application.issue', { quantity: 2 }), { issued: 2 });
    assert.ok(received);
    assert.equal(Object.getPrototypeOf(received), null);
    assert.equal(Object.isFrozen(received), true);
  } finally {
    closeContext(context);
  }
});

test('rejects unknown commands, duplicate definitions and forbidden sources', () => {
  const allowed = executionContext();
  const forbidden = executionContext('asset_work_order_bridge');
  const definition: DomainCommandDefinition = Object.freeze({
    id: 'inventory.application.issue',
    allowedSources: Object.freeze(['inventory_application_bridge']),
    parse: (payload: JsonObject) => payload,
    execute: () => undefined
  });

  try {
    const bus = new AllowlistedDomainCommandBus([definition], allowed);
    assert.throws(() => bus.invoke('missing.command', {}), /not registered/i);
    assert.throws(
      () => new AllowlistedDomainCommandBus([definition, definition], allowed),
      /already registered/i
    );
    assert.throws(
      () => new AllowlistedDomainCommandBus([definition], forbidden)
        .invoke('inventory.application.issue', {}),
      /not allowed/i
    );
  } finally {
    closeContext(allowed);
    closeContext(forbidden);
  }
});

test('rejects oversized, cyclic, executable, accessor and non-finite payloads before parsing', () => {
  const context = executionContext();
  let parseCalls = 0;
  const definition: DomainCommandDefinition = Object.freeze({
    id: 'safe.command',
    allowedSources: Object.freeze(['inventory_application_bridge']),
    parse: (payload: JsonObject) => {
      parseCalls += 1;
      return payload;
    },
    execute: () => undefined
  });
  const bus = new AllowlistedDomainCommandBus([definition], context);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });

  try {
    assert.throws(() => bus.invoke('safe.command', { value: 'x'.repeat(65_537) }), /64 KiB/i);
    assert.throws(() => bus.invoke('safe.command', cyclic as never), /acyclic JSON/i);
    assert.throws(() => bus.invoke('safe.command', { value: () => 1 } as never), /JSON data/i);
    assert.throws(() => bus.invoke('safe.command', accessor as never), /plain JSON/i);
    assert.throws(() => bus.invoke('safe.command', { value: Number.POSITIVE_INFINITY }), /finite/i);
    assert.equal(parseCalls, 0);
  } finally {
    closeContext(context);
  }
});

test('preserves own prototype-named keys without changing the normalized prototype', () => {
  const context = executionContext();
  let received: Readonly<Record<string, unknown>> | undefined;
  const definition: DomainCommandDefinition = Object.freeze({
    id: 'safe.command',
    allowedSources: Object.freeze(['inventory_application_bridge']),
    parse: (payload: JsonObject) => payload,
    execute: (_execution: DomainCommandExecutionContext, payload: JsonObject) => {
      received = payload;
      return undefined;
    }
  });

  try {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":"kept"}') as never;
    new AllowlistedDomainCommandBus([definition], context).invoke('safe.command', payload);
    assert.ok(received);
    assert.equal(Object.getPrototypeOf(received), null);
    assert.equal(Object.hasOwn(received, '__proto__'), true);
    assert.equal(Object.hasOwn(received, 'constructor'), true);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  } finally {
    closeContext(context);
  }
});
