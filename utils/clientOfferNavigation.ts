export const ensureClientOfferAvailable = async <T extends { id: string }>(
  offerId: string,
  currentOffers: T[],
  loadOffers: () => Promise<T[]>,
): Promise<T[]> => {
  if (currentOffers.some((offer) => offer.id === offerId)) {
    return currentOffers;
  }

  const offers = await loadOffers();
  if (!offers.some((offer) => offer.id === offerId)) {
    throw new Error(`Created client offer ${offerId} is not available`);
  }
  return offers;
};
