export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RuntimePluginSelection {
  readonly id: string;
  readonly config: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeSoftware {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly purpose?: string;
  readonly targetUsers?: readonly string[];
  readonly boundaries?: readonly string[];
  readonly loginMode?: 'required' | 'optional' | 'disabled';
}

export interface RuntimeField {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'enum' | 'reference';
  readonly required: boolean;
  readonly unique: boolean;
  readonly default?: JsonValue;
  readonly options?: readonly string[];
  readonly reference?: Readonly<{ entity: string; field: string }>;
}

export interface RuntimeRelation {
  readonly id: string;
  readonly name: string;
  readonly field: string;
  readonly targetEntity: string;
  readonly targetField: string;
  readonly onDelete: 'restrict' | 'cascade' | 'set_null';
}

export interface RuntimeEntity {
  readonly id: string;
  readonly name: string;
  readonly retention: 'mutable' | 'protected' | 'append_only';
  readonly history: boolean;
  readonly systemManaged: boolean;
  readonly fields: readonly RuntimeField[];
  readonly relations: readonly RuntimeRelation[];
  readonly detailTabs?: readonly Readonly<{
    id: string;
    name: string;
    viewId: string;
  }>[];
  readonly createSources?: readonly Readonly<{
    id: string;
    name: string;
  }>[];
}

export interface RuntimeModule {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly entity: string;
  readonly actions: readonly string[];
}

export interface RuntimeRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

export interface RuntimeCondition {
  readonly type: 'required_field' | 'field_equals' | 'relation_exists';
  readonly parameters: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeAction {
  readonly type: 'set_field' | 'create_record' | 'update_related' | 'append_event' | 'write_audit';
  readonly parameters: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeTransition {
  readonly id: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly permission: string;
  readonly conditions: readonly RuntimeCondition[];
  readonly actions: readonly RuntimeAction[];
}

export interface RuntimeWorkflow {
  readonly id: string;
  readonly name: string;
  readonly entity: string;
  readonly initialState: string;
  readonly terminalStates: readonly string[];
  readonly states: readonly string[];
  readonly transitions: readonly RuntimeTransition[];
}

export interface RuntimeBlueprint {
  readonly schemaVersion: '1.0';
  readonly software: RuntimeSoftware;
  readonly plugins: readonly RuntimePluginSelection[];
  readonly archetypes?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly modules?: readonly RuntimeModule[];
  readonly entities?: readonly RuntimeEntity[];
  readonly roles?: readonly RuntimeRole[];
  readonly workflows?: readonly RuntimeWorkflow[];
  readonly dashboards?: readonly Readonly<Record<string, JsonValue>>[];
  readonly demoData?: Readonly<Record<string, JsonValue>>;
  readonly materials?: Readonly<Record<string, JsonValue>>;
}
