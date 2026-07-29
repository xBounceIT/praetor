import { describe, expect, mock, test } from 'bun:test';
import { ensureClientOfferAvailable } from '../../utils/clientOfferNavigation';

describe('ensureClientOfferAvailable', () => {
  test('reuses the local cache when it already contains the created offer', async () => {
    const currentOffers = [{ id: 'offer-1' }];
    const loadOffers = mock(() => Promise.resolve([{ id: 'offer-1' }]));

    await expect(ensureClientOfferAvailable('offer-1', currentOffers, loadOffers)).resolves.toBe(
      currentOffers,
    );
    expect(loadOffers).not.toHaveBeenCalled();
  });

  test('reloads a missing created offer before navigation can continue', async () => {
    const loadedOffers = [{ id: 'offer-1' }, { id: 'offer-2' }];

    await expect(
      ensureClientOfferAvailable('offer-2', [{ id: 'offer-1' }], () =>
        Promise.resolve(loadedOffers),
      ),
    ).resolves.toBe(loadedOffers);
  });

  test('rejects when a successful reload still cannot provide the created offer', async () => {
    await expect(
      ensureClientOfferAvailable('offer-2', [], () => Promise.resolve([{ id: 'offer-1' }])),
    ).rejects.toThrow('Created client offer offer-2 is not available');
  });
});
