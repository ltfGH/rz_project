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
    const permissions = this.#permissions.get(actor.roleId);
    if (!permissions?.has(permission)) {
      throw new AppError('PERMISSION_DENIED', '当前用户没有执行此操作的权限。');
    }
  }
}
