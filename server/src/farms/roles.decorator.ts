import { SetMetadata } from '@nestjs/common';

export type FarmRoleName = 'OWNER' | 'WORKER';

export const FARM_ROLES_KEY = 'qamqor:farmRoles';
export const BOUNDARY_EDIT_KEY = 'qamqor:boundaryEdit';

/** Route allowed only for the listed roles of the resolved farm (e.g. `@FarmRoles('OWNER')`). */
export const FarmRoles = (...roles: FarmRoleName[]) => SetMetadata(FARM_ROLES_KEY, roles);

/**
 * Route allowed for the owner, or for a worker when the owner has switched on
 * `workerCanEditBoundaries` (contract right "B").
 */
export const RequireBoundaryEdit = () => SetMetadata(BOUNDARY_EDIT_KEY, true);
