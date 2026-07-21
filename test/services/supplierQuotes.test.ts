import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<Response> =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { supplierQuotesApi } = await import('../../services/api/supplierQuotes');
const { getApiBase, setAuthToken } = await import('../../services/api/client');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async (_input: unknown, _init?: unknown) =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('supplierQuotesApi path segments', () => {
  test('encodes quote, version, revision, and attachment ids at every dynamic path sink', async () => {
    const quoteId = '../../products/prod-9?admin=true#fragment';
    const versionId = '../versions/ver-1?force=true#fragment';
    const revisionId = '../revisions/rev-1?force=true#fragment';
    const attachmentId = '../attachments/att-1?force=true#fragment';
    const quoteSegment = encodeURIComponent(quoteId);
    const versionSegment = encodeURIComponent(versionId);
    const revisionSegment = encodeURIComponent(revisionId);
    const attachmentSegment = encodeURIComponent(attachmentId);
    const file = new File(['content'], 'quote.pdf', { type: 'application/pdf' });

    await supplierQuotesApi.update(quoteId, { notes: 'updated' });
    await supplierQuotesApi.delete(quoteId);
    await supplierQuotesApi.listVersions(quoteId);
    await supplierQuotesApi.getVersion(quoteId, versionId);
    await supplierQuotesApi.restoreVersion(quoteId, versionId);
    await supplierQuotesApi.listRevisions(quoteId);
    await supplierQuotesApi.getRevision(quoteId, revisionId);
    await supplierQuotesApi.restoreRevision(quoteId, revisionId);
    await supplierQuotesApi.listAttachments(quoteId);
    await supplierQuotesApi.uploadAttachment(quoteId, file);
    await supplierQuotesApi.downloadAttachment(quoteId, attachmentId);
    await supplierQuotesApi.deleteAttachment(quoteId, attachmentId);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/versions`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/versions/${versionSegment}`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/versions/${versionSegment}/restore`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/revisions`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/revisions/${revisionSegment}`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/revisions/${revisionSegment}/restore`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/attachments`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/attachments`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/attachments/${attachmentSegment}/download`,
      `${getApiBase()}/sales/supplier-quotes/${quoteSegment}/attachments/${attachmentSegment}`,
    ]);
  });
});
