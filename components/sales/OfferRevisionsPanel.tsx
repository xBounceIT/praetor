import { clientOffersApi } from '@/services/api/clientOffers';
import type { ClientOffer, OfferRevision } from '@/types';
import { RevisionHistoryPanel } from '../shared/RevisionHistoryPanel';

type OfferRevisionApi = Pick<
  typeof clientOffersApi,
  'listRevisions' | 'getRevision' | 'restoreRevision'
>;

export const OfferRevisionsPanel = (props: {
  offerId: string;
  selectedRevisionId: string | null;
  onPreview: (revision: OfferRevision) => void;
  onClearPreview: () => void;
  onRestored: (offer: ClientOffer) => void;
  disabled?: boolean;
  revisionApi?: OfferRevisionApi;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}) => (
  <RevisionHistoryPanel
    objectId={props.offerId}
    translationPrefix="clientOffers"
    selectedRevisionId={props.selectedRevisionId}
    list={(props.revisionApi ?? clientOffersApi).listRevisions}
    get={(props.revisionApi ?? clientOffersApi).getRevision}
    restore={(props.revisionApi ?? clientOffersApi).restoreRevision}
    onPreview={props.onPreview}
    onClearPreview={props.onClearPreview}
    onRestored={props.onRestored}
    disabled={props.disabled}
    secondaryAction={props.secondaryAction}
    className={props.className}
  />
);
