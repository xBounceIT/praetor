import type React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supplierQuotesApi } from '../../services/api/supplierQuotes';
import type { SupplierQuoteAttachment } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import FieldTooltip from '../shared/FieldTooltip';

const ALLOWED_EXT = new Set(['xlsx', 'pdf', 'docx']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPT_ATTR = '.xlsx,.pdf,.docx';

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
};

const getExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
};

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
  const tRef = useRef(t);
  tRef.current = t;
  const [attachmentState, dispatchAttachments] = useReducer(attachmentReducer, {
    attachments: [],
    isLoading: true,
    error: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
  }, [quoteId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (file.size > MAX_FILE_SIZE) {
        return t('sales:supplierQuotes.attachments.errors.tooLarge', {
          defaultValue: 'File exceeds the 10 MB upload limit',
        });
      }
      const ext = getExtension(file.name);
      if (!ALLOWED_EXT.has(ext)) {
        return t('sales:supplierQuotes.attachments.errors.invalidType', {
          defaultValue: 'File type not allowed. Use xlsx, pdf, or docx.',
        });
      }
      return null;
    },
    [t],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        dispatchAttachments({ type: 'error', message: validationError });
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
    [quoteId, t, validateFile],
  );

  const handleFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so selecting the same file again still triggers a change event.
      event.target.value = '';
      if (file) await handleUpload(file);
    },
    [handleUpload],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (isReadOnly || isUploading) return;
      const file = event.dataTransfer.files?.[0];
      if (file) await handleUpload(file);
    },
    [handleUpload, isReadOnly, isUploading],
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
        // <label> + hidden <input type="file"> gets us native click-to-open and keyboard focus
        // without needing role="button" on a div. Drag handlers stay on the label.
        <label
          onDragOver={(event) => {
            event.preventDefault();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          aria-label={t('sales:supplierQuotes.attachments.uploadButton', {
            defaultValue: 'Upload file',
          })}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-all cursor-pointer ${
            isDragging
              ? 'border-praetor bg-praetor/5'
              : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
          } ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <i className="fa-solid fa-cloud-arrow-up text-2xl text-zinc-400"></i>
          <span className="font-bold text-zinc-600">
            {isUploading
              ? t('sales:supplierQuotes.attachments.uploading', { defaultValue: 'Uploading...' })
              : t('sales:supplierQuotes.attachments.dropHere', {
                  defaultValue: 'Drop a file here or click to upload',
                })}
          </span>
          <span className="text-xs text-zinc-400">
            {t('sales:supplierQuotes.attachments.allowedTypes', {
              defaultValue: 'Allowed: xlsx, pdf, docx · max 10 MB',
            })}
          </span>
          <input
            type="file"
            accept={ACCEPT_ATTR}
            disabled={isUploading}
            aria-label={t('sales:supplierQuotes.attachments.dropHere', {
              defaultValue: 'Drop a file here or click to upload',
            })}
            className="hidden"
            onChange={handleFileInputChange}
          />
        </label>
      )}

      {attachmentState.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
            <li key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
              <i className="fa-solid fa-file-lines text-zinc-400"></i>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-zinc-700 truncate">
                  {attachment.fileName}
                </div>
                <div className="text-xs text-zinc-400">
                  {formatFileSize(attachment.fileSize)}
                  {attachment.createdAt
                    ? ` · ${formatInsertDateTime(attachment.createdAt, i18n.language)}`
                    : ''}
                </div>
              </div>
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
            </li>
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
