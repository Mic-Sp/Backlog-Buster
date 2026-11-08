export const isPositiveTasteRating = (rating: number | null): rating is number =>
  Number.isInteger(rating) && rating! >= 4 && rating! <= 5;
