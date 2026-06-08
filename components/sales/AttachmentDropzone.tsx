import type React from 'react';
import { useCallback, useState } from 'react';
import { ATTACHMENT_ACCEPT_ATTR } from '../../utils/supplierQuoteAttachments';

interface AttachmentDropzoneProps {
  /** Receives the picked or dropped file. The caller validates it and decides what to do with it. */
  onFile: (file: File) => void;
  /** Dims the zone and blocks interaction (read-only, uploading, or a save in flight). */
  busy?: boolean;
  /** Main call-to-action text; callers swap in an "Uploading…" variant while busy. */
  primaryLabel: string;
  /** Secondary hint, e.g. "Allowed: xlsx, pdf, docx · max 10 MB". */
  allowedTypesLabel: string;
  /** aria-label for the drop target (the label). */
  uploadButtonLabel: string;
  /** aria-label for the hidden file input. */
  inputLabel: string;
}

/**
 * Shared dropzone for supplier-quote attachments: a <label> wrapping a hidden file <input> (native
 * click-to-open and keyboard focus without role="button") plus drag-and-drop. It owns only the
 * transient `isDragging` highlight — validation and what-to-do-with-the-file live in the caller's
 * `onFile`. Used by both the live (SupplierQuoteAttachmentsSection) and staging
 * (SupplierQuoteAttachmentsStaging) flows so the two dropzones cannot drift apart.
 */
const AttachmentDropzone: React.FC<AttachmentDropzoneProps> = ({
  onFile,
  busy = false,
  primaryLabel,
  allowedTypesLabel,
  uploadButtonLabel,
  inputLabel,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const emit = useCallback(
    (file: File | undefined) => {
      if (busy || !file) return;
      onFile(file);
    },
    [busy, onFile],
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so picking the same file again still fires a change event.
      event.target.value = '';
      emit(file);
    },
    [emit],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      emit(event.dataTransfer.files?.[0]);
    },
    [emit],
  );

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      aria-label={uploadButtonLabel}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-all cursor-pointer ${
        isDragging
          ? 'border-praetor bg-praetor/5'
          : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
      } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <i className="fa-solid fa-cloud-arrow-up text-2xl text-zinc-400"></i>
      <span className="font-bold text-zinc-600">{primaryLabel}</span>
      <span className="text-xs text-zinc-400">{allowedTypesLabel}</span>
      <input
        type="file"
        accept={ATTACHMENT_ACCEPT_ATTR}
        disabled={busy}
        aria-label={inputLabel}
        className="hidden"
        onChange={handleFileInputChange}
      />
    </label>
  );
};

export default AttachmentDropzone;
