import { supplierQuotesApi } from '@/services/api/supplierQuotes';
import type { SupplierQuote, SupplierQuoteRevision } from '@/types';
import { RevisionHistoryPanel } from '../shared/RevisionHistoryPanel';

export const SupplierQuoteRevisionsPanel = (props: {
  quoteId: string;
  selectedRevisionId: string | null;
  onPreview: (revision: SupplierQuoteRevision) => void;
  onClearPreview: () => void;
  onRestored: (quote: SupplierQuote) => void;
  disabled?: boolean;
}) => (
  <RevisionHistoryPanel
    objectId={props.quoteId}
    translationPrefix="supplierQuotes"
    selectedRevisionId={props.selectedRevisionId}
    list={supplierQuotesApi.listRevisions}
    get={supplierQuotesApi.getRevision}
    restore={supplierQuotesApi.restoreRevision}
    onPreview={props.onPreview}
    onClearPreview={props.onClearPreview}
    onRestored={props.onRestored}
    disabled={props.disabled}
  />
);
