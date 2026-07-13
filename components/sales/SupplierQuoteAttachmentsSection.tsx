import type React from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLatestRef } from '../../hooks/useLatestRef';
import { supplierQuotesApi } from '../../services/api/supplierQuotes';
import type { SupplierQuoteAttachment } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import {
  attachmentValidationMessage,
  formatAttachmentFileSize,
  validateAttachmentFile,
} from '../../utils/supplierQuoteAttachments';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import FieldTooltip from '../shared/FieldTooltip';
import AttachmentDropzone from './AttachmentDropzone';
import AttachmentRow from './AttachmentRow';

type AttachmentState = {
  attachments: SupplierQuoteAttachment[];
  isLoading: boolean;
  error: string | null;
};

type AttachmentAction =
  | { type: 'loading' }
  | { type: 'loaded'; attachments: SupplierQuoteAttachment[]; error?: string | null }
  | { type: 'error'; message: string }
  | { type: 'prepend'; attachment: SupplierQuoteAttachment }
  | { type: 'remove'; attachmentId: string };

const attachmentReducer = (state: AttachmentState, action: AttachmentAction): AttachmentState => {
  switch (action.type) {
    case 'loading':
      return { ...state, isLoading: true, error: null };
    case 'loaded':
      return { attachments: action.attachments, isLoading: false, error: action.error ?? null };
    case 'error':
      return { ...state, error: action.message };
    case 'prepend':
      return { ...state, error: null, attachments: [action.attachment, ...state.attachments] };
    case 'remove':
      return {
        ...state,
        error: null,
        attachments: state.attachments.filter(
          (attachment) => attachment.id !== action.attachmentId,
        ),
      };
  }
};

interface SupplierQuoteAttachmentsSectionProps {
  quoteId: string;
  isReadOnly: boolean;
  /** Resolved string for the FieldTooltip status row (e.g. "Editable" or the read-only reason). */
  readOnlyStatus: string;
  /** Localized "Status:" label prefix; mirrors the other sections in SupplierQuotesView. */
  statusLabel: string;
}

const SupplierQuoteAttachmentsSection: React.FC<SupplierQuoteAttachmentsSectionProps> = ({
  quoteId,
  isReadOnly,
  readOnlyStatus,
  statusLabel,
}) => {
  const { t, i18n } = useTranslation(['sales', 'common']);
  const tRef = useLatestRef(t);
  const [attachmentState, dispatchAttachments] = useReducer(attachmentReducer, {
    attachments: [],
    isLoading: true,
    error: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SupplierQuoteAttachment | null>(null);

  const reload = useCallback(async () => {
    dispatchAttachments({ type: 'loading' });
    try {
      const data = await supplierQuotesApi.listAttachments(quoteId);
      dispatchAttachments({ type: 'loaded', attachments: data });
    } catch {
      dispatchAttachments({
        type: 'loaded',
        attachments: [],
        error: tRef.current('sales:supplierQuotes.attachments.loadFailed', {
          defaultValue: 'Failed to load attachments.',
        }),
      });
    }
  }, [quoteId, tRef]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleUpload = useCallback(
    async (file: File) => {
      const code = validateAttachmentFile(file);
      if (code) {
        const { key, defaultValue } = attachmentValidationMessage(code);
        dispatchAttachments({ type: 'error', message: t(key, { defaultValue }) });
        return;
      }
      setIsUploading(true);
      try {
        const created = await supplierQuotesApi.uploadAttachment(quoteId, file);
        dispatchAttachments({ type: 'prepend', attachment: created });
      } catch (e) {
        dispatchAttachments({
          type: 'error',
          message:
            e instanceof Error && e.message
              ? e.message
              : t('sales:supplierQuotes.attachments.errors.uploadFailed', {
                  defaultValue: 'Upload failed',
                }),
        });
      } finally {
        setIsUploading(false);
      }
    },
    [quoteId, t],
  );

  const handleDownload = useCallback(
    async (attachment: SupplierQuoteAttachment) => {
      try {
        const blob = await supplierQuotesApi.downloadAttachment(quoteId, attachment.id);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        dispatchAttachments({
          type: 'error',
          message:
            e instanceof Error && e.message
              ? e.message
              : t('sales:supplierQuotes.attachments.errors.downloadFailed', {
                  defaultValue: 'Download failed',
                }),
        });
      }
    },
    [quoteId, t],
  );

  const handleDeleteConfirmed = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      await supplierQuotesApi.deleteAttachment(quoteId, pendingDelete.id);
      dispatchAttachments({ type: 'remove', attachmentId: pendingDelete.id });
    } catch (e) {
      dispatchAttachments({
        type: 'error',
        message:
          e instanceof Error && e.message
            ? e.message
            : t('sales:supplierQuotes.attachments.errors.deleteFailed', {
                defaultValue: 'Delete failed',
              }),
      });
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, quoteId, t]);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('sales:supplierQuotes.attachments.title', { defaultValue: 'Attachments' })}
        <FieldTooltip
          description={t('sales:fieldInfo.attachments', {
            defaultValue: 'Files received from the supplier',
          })}
          status={readOnlyStatus}
          statusLabel={statusLabel}
        />
      </h4>

      {!isReadOnly && (
        <AttachmentDropzone
          onFile={handleUpload}
          busy={isUploading}
          primaryLabel={
            isUploading
              ? t('sales:supplierQuotes.attachments.uploading', { defaultValue: 'Uploading...' })
              : t('sales:supplierQuotes.attachments.dropHere', {
                  defaultValue: 'Drop a file here or click to upload',
                })
          }
          allowedTypesLabel={t('sales:supplierQuotes.attachments.allowedTypes', {
            defaultValue: 'Allowed: xlsx, pdf, docx · max 10 MB',
          })}
          uploadButtonLabel={t('sales:supplierQuotes.attachments.uploadButton', {
            defaultValue: 'Upload file',
          })}
          inputLabel={t('sales:supplierQuotes.attachments.dropHere', {
            defaultValue: 'Drop a file here or click to upload',
          })}
        />
      )}

      {attachmentState.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {attachmentState.error}
        </div>
      )}

      {attachmentState.isLoading ? (
        <div className="text-center py-4 text-zinc-400 text-sm">
          <i className="fa-solid fa-spinner fa-spin"></i>
        </div>
      ) : attachmentState.attachments.length === 0 ? (
        <div className="text-center py-4 text-zinc-400 text-sm">
          {t('sales:supplierQuotes.attachments.empty', { defaultValue: 'No attachments yet.' })}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {attachmentState.attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              fileName={attachment.fileName}
              meta={`${formatAttachmentFileSize(attachment.fileSize)}${
                attachment.createdAt
                  ? ` · ${formatInsertDateTime(attachment.createdAt, i18n.language)}`
                  : ''
              }`}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => handleDownload(attachment)}
                    className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                    aria-label={t('sales:supplierQuotes.attachments.downloadAction', {
                      defaultValue: 'Download',
                    })}
                  >
                    <i className="fa-solid fa-download"></i>
                  </button>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(attachment)}
                      className="p-2 rounded-lg transition-all text-red-600 hover:text-red-600 hover:bg-red-50"
                      aria-label={t('sales:supplierQuotes.attachments.deleteAction', {
                        defaultValue: 'Delete',
                      })}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}

      <DeleteConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirmed}
        title={t('sales:supplierQuotes.attachments.deleteConfirm', {
          defaultValue: 'Remove this attachment?',
        })}
        description={pendingDelete?.fileName}
      />
    </div>
  );
};

export default SupplierQuoteAttachmentsSection;
