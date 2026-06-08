import type React from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  attachmentValidationMessage,
  formatAttachmentFileSize,
  validateAttachmentFile,
} from '../../utils/supplierQuoteAttachments';
import FieldTooltip from '../shared/FieldTooltip';
import AttachmentDropzone from './AttachmentDropzone';
import AttachmentRow from './AttachmentRow';

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
 * always editable, so there is no read-only variant here. The dropzone and row markup are shared
 * with the live section via AttachmentDropzone / AttachmentRow.
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

  const acceptFile = useCallback(
    (file: File) => {
      const code = validateAttachmentFile(file);
      if (code) {
        const { key, defaultValue } = attachmentValidationMessage(code);
        setError(t(key, { defaultValue }));
        return;
      }
      setError(null);
      onAdd(file);
    },
    [onAdd, t],
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

      <AttachmentDropzone
        onFile={acceptFile}
        busy={disabled}
        primaryLabel={t('supplierQuotes.attachments.dropHere', {
          defaultValue: 'Drop a file here or click to upload',
        })}
        allowedTypesLabel={t('supplierQuotes.attachments.allowedTypes', {
          defaultValue: 'Allowed: xlsx, pdf, docx · max 10 MB',
        })}
        uploadButtonLabel={t('supplierQuotes.attachments.uploadButton', {
          defaultValue: 'Upload file',
        })}
        inputLabel={t('supplierQuotes.attachments.dropHere', {
          defaultValue: 'Drop a file here or click to upload',
        })}
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {files.map((file, index) => (
            <AttachmentRow
              // Staged files have no server id yet; name+size+position is stable enough here.
              key={`${file.name}-${file.size}-${index}`}
              fileName={file.name}
              meta={formatAttachmentFileSize(file.size)}
              actions={
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
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default SupplierQuoteAttachmentsStaging;
