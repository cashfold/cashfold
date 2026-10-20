/** A member's authority in one Fold, lowest to highest. */
export type Role = 'viewer' | 'editor' | 'owner';

const RANK: Readonly<Record<Role, number>> = { viewer: 1, editor: 2, owner: 3 };

export const roleAtLeast = (actual: Role, required: Role): boolean => RANK[actual] >= RANK[required];
