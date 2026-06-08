import type React from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ATTACHMENT_ACCEPT_ATTR,
  type AttachmentValidationError,
  formatAttachmentFileSize,
  validateAttachmentFile,
} from '../../utils/supplierQuoteAttachments';
import FieldTooltip from '../shared/FieldTooltip';

interface SupplierQuoteAttachmentsStagingProps {
  /**
   * Files queued for upload. The parent (SupplierQuotesView) owns this list so it can flush the
   * queue to the server right after the quote is created — a brand-new quote has no id yet, so the
   * files can't be uploaded immediately the way the persisted section does.
   */
  files: File[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  /**
   * Locks the queue while the parent is saving. handleSubmit captures the queue at submit time and
   * uploads that snapshot; a file added (or removed) during the in-flight save would not be in it and
   * would be silently dropped when the modal closes, so the controls are disabled meanwhile.
   */
  disabled?: boolean;
  /** Resolved FieldTooltip status string; mirrors the other sections in SupplierQuotesView. */
  readOnlyStatus: string;
  /** Localized "Status:" label prefix. */
  statusLabel: string;
}

/**
 * Create-flow counterpart to SupplierQuoteAttachmentsSection. A new quote isn't persisted yet, so
 * there's nothing to upload against; this buffers the chosen files (validated client-side with the
 * same rules as the live section) and the parent uploads them once the quote exists. A new quote is
 * always editable, so there is no read-only variant here.
 */
const SupplierQuoteAttachmentsStaging: React.FC<SupplierQuoteAttachmentsStagingProps> = ({
  files,
  onAdd,
  onRemove,
  disabled = false,
  readOnlyStatus,
  statusLabel,
}) => {
  const { t } = useTranslation('sales');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const validationMessage = useCallback(
    (code: AttachmentValidationError): string =>
      code === 'tooLarge'
        ? t('supplierQuotes.attachments.errors.tooLarge', {
            defaultValue: 'File exceeds the 10 MB upload limit',
          })
        : t('supplierQuotes.attachments.errors.invalidType', {
            defaultValue: 'File type not allowed. Use xlsx, pdf, or docx.',
          }),
    [t],
  );

  const acceptFile = useCallback(
    (file: File) => {
      if (disabled) return;
      const code = validateAttachmentFile(file);
      if (code) {
        setError(validationMessage(code));
        return;
      }
      setError(null);
      onAdd(file);
    },
    [disabled, onAdd, validationMessage],
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so picking the same file again still fires a change event.
      event.target.value = '';
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('supplierQuotes.attachments.title', { defaultValue: 'Attachments' })}
        <FieldTooltip
          description={t('fieldInfo.attachments', {
            defaultValue: 'Files received from the supplier',
          })}
          status={readOnlyStatus}
          statusLabel={statusLabel}
        />
      </h4>

      <p className="text-xs text-muted-foreground">
        {t('supplierQuotes.attachments.pendingUploadHint', {
          defaultValue: 'Files are uploaded when you save the quote.',
        })}
      </p>

      {/* <label> + hidden file input gives native click-to-open and keyboard focus; drag stays on the label. */}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        aria-label={t('supplierQuotes.attachments.uploadButton', { defaultValue: 'Upload file' })}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-all cursor-pointer ${
          isDragging
            ? 'border-praetor bg-praetor/5'
            : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
        } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <i className="fa-solid fa-cloud-arrow-up text-2xl text-zinc-400"></i>
        <span className="font-bold text-zinc-600">
          {t('supplierQuotes.attachments.dropHere', {
            defaultValue: 'Drop a file here or click to upload',
          })}
        </span>
        <span className="text-xs text-zinc-400">
          {t('supplierQuotes.attachments.allowedTypes', {
            defaultValue: 'Allowed: xlsx, pdf, docx · max 10 MB',
          })}
        </span>
        <input
          type="file"
          accept={ATTACHMENT_ACCEPT_ATTR}
          disabled={disabled}
          aria-label={t('supplierQuotes.attachments.dropHere', {
            defaultValue: 'Drop a file here or click to upload',
          })}
          className="hidden"
          onChange={handleFileInputChange}
        />
      </label>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {files.map((file, index) => (
            <li
              // Staged files have no server id yet; name+size+position is stable enough for this short-lived list.
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <i className="fa-solid fa-file-lines text-zinc-400"></i>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-zinc-700 truncate">{file.name}</div>
                <div className="text-xs text-zinc-400">{formatAttachmentFileSize(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                className="p-2 rounded-lg transition-all text-red-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:pointer-events-none"
                aria-label={t('supplierQuotes.attachments.removeStaged', {
                  defaultValue: 'Remove',
                })}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SupplierQuoteAttachmentsStaging;
