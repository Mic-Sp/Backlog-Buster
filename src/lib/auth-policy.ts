// A registered account may authenticate with a local password, Google, or both.
// Keep verification independent from authorization and exclude unclaimed profiles.
export const registeredPlayerWhere = {
  email: { not: null },
  OR: [{ passwordHash: { not: null } }, { googleId: { not: null } }],
};
