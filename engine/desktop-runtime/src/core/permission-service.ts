import type { RuntimeBlueprint } from '../shared/blueprint';
import type { ActorDto } from '../shared/dto';
import { AppError } from '../shared/errors';

export class PermissionService {
  readonly #permissions = new Map<string, ReadonlySet<string>>();

  constructor(blueprint: RuntimeBlueprint) {
    for (const role of blueprint.roles ?? []) {
      this.#permissions.set(role.id, new Set(role.permissions));
    }
  }

  require(actor: ActorDto, permission: string): void {
    if (!this.allows(actor, permission)) {
      throw new AppError('PERMISSION_DENIED', '当前用户没有执行此操作的权限。');
    }
  }

  allows(actor: ActorDto, permission: string): boolean {
    return this.#permissions.get(actor.roleId)?.has(permission) ?? false;
  }

  roleIncludes(roleId: string, requiredRoleId: string): boolean {
    if (roleId === requiredRoleId) return true;
    const actual = this.#permissions.get(roleId);
    const required = this.#permissions.get(requiredRoleId);
    return Boolean(actual && required && [...required].every((permission) => actual.has(permission)));
  }
}
