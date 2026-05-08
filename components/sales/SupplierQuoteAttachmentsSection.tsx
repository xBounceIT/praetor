import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supplierQuotesApi } from '../../services/api/supplierQuotes';
import type { SupplierQuoteAttachment } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import FieldTooltip from '../shared/FieldTooltip';

const ALLOWED_EXT = new Set(['xlsx', 'xls', 'csv', 'pdf', 'doc', 'docx']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPT_ATTR = '.xlsx,.xls,.csv,.pdf,.doc,.docx';

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
  const [attachments, setAttachments] = useState<SupplierQuoteAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SupplierQuoteAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await supplierQuotesApi.listAttachments(quoteId);
      setAttachments(data);
      setError(null);
    } catch {
      setError(
        t('sales:supplierQuotes.attachments.loadFailed', {
          defaultValue: 'Failed to load attachments.',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [quoteId, t]);

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
          defaultValue: 'File type not allowed. Use xlsx, xls, csv, pdf, doc, or docx.',
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
        setError(validationError);
        return;
      }
      setIsUploading(true);
      setError(null);
      try {
        const created = await supplierQuotesApi.uploadAttachment(quoteId, file);
        setAttachments((prev) => [created, ...prev]);
      } catch (e) {
        setError(
          e instanceof Error && e.message
            ? e.message
            : t('sales:supplierQuotes.attachments.errors.uploadFailed', {
                defaultValue: 'Upload failed',
              }),
        );
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
        setError(null);
      } catch (e) {
        setError(
          e instanceof Error && e.message
            ? e.message
            : t('sales:supplierQuotes.attachments.errors.downloadFailed', {
                defaultValue: 'Download failed',
              }),
        );
      }
    },
    [quoteId, t],
  );

  const handleDeleteConfirmed = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      await supplierQuotesApi.deleteAttachment(quoteId, pendingDelete.id);
      setAttachments((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : t('sales:supplierQuotes.attachments.errors.deleteFailed', {
              defaultValue: 'Delete failed',
            }),
      );
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, quoteId, t]);

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
        <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
        {t('sales:supplierQuotes.attachments.title', { defaultValue: 'Attachments' })}
        <FieldTooltip
          description={t('sales:fieldInfo.attachments', {
            defaultValue:
              'Files received from the supplier (xlsx, pdf, doc...). Editable on draft quotes only.',
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
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
          } ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <i className="fa-solid fa-cloud-arrow-up text-2xl text-slate-400"></i>
          <span className="font-bold text-slate-600">
            {isUploading
              ? t('sales:supplierQuotes.attachments.uploading', { defaultValue: 'Uploading...' })
              : t('sales:supplierQuotes.attachments.dropHere', {
                  defaultValue: 'Drop a file here or click to upload',
                })}
          </span>
          <span className="text-xs text-slate-400">
            {t('sales:supplierQuotes.attachments.allowedTypes', {
              defaultValue: 'Allowed: xlsx, xls, csv, pdf, doc, docx · max 10 MB',
            })}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            disabled={isUploading}
            className="hidden"
            onChange={handleFileInputChange}
          />
        </label>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-4 text-slate-400 text-sm">
          <i className="fa-solid fa-spinner fa-spin"></i>
        </div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-4 text-slate-400 text-sm">
          {t('sales:supplierQuotes.attachments.empty', { defaultValue: 'No attachments yet.' })}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
              <i className="fa-solid fa-file-lines text-slate-400"></i>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-700 truncate">
                  {attachment.fileName}
                </div>
                <div className="text-xs text-slate-400">
                  {formatFileSize(attachment.fileSize)}
                  {attachment.createdAt
                    ? ` · ${formatInsertDateTime(attachment.createdAt, i18n.language)}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(attachment)}
                className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
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
                  className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
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
