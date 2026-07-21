import { clientQuotesApi } from '@/services/api/clientQuotes';
import type { Quote, QuoteRevision } from '@/types';
import { RevisionHistoryPanel } from '../shared/RevisionHistoryPanel';

export const QuoteRevisionsPanel = (props: {
  quoteId: string;
  selectedRevisionId: string | null;
  onPreview: (revision: QuoteRevision) => void;
  onClearPreview: () => void;
  onRestored: (quote: Quote) => void;
  disabled?: boolean;
}) => (
  <RevisionHistoryPanel
    objectId={props.quoteId}
    translationPrefix="clientQuotes"
    selectedRevisionId={props.selectedRevisionId}
    list={clientQuotesApi.listRevisions}
    get={clientQuotesApi.getRevision}
    restore={clientQuotesApi.restoreRevision}
    onPreview={props.onPreview}
    onClearPreview={props.onClearPreview}
    onRestored={props.onRestored}
    disabled={props.disabled}
  />
);
