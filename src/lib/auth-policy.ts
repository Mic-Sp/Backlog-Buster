// A registered account may authenticate with email credentials, Google, or Steam.
// Keep verification independent from authorization and exclude unclaimed profiles.
export const registeredPlayerWhere = {
  OR: [
    { email: { not: null }, OR: [{ passwordHash: { not: null } }, { googleId: { not: null } }] },
    { steamVerifiedId: { not: null } },
  ],
};
