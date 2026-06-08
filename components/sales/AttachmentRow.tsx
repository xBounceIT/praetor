import type React from 'react';

interface AttachmentRowProps {
  fileName: string;
  /** Sub-line under the name, e.g. a formatted size (optionally with an upload date). */
  meta: string;
  /** Trailing action button(s): download/delete for saved files, remove for staged ones. */
  actions: React.ReactNode;
}

/**
 * One row in a supplier-quote attachment list: file icon, truncated name, a meta sub-line, and
 * caller-supplied trailing actions. Shared by the live and staging attachment lists so their row
 * layout stays in lockstep. The list <ul> and the row `key` stay with the caller that maps the data.
 */
const AttachmentRow: React.FC<AttachmentRowProps> = ({ fileName, meta, actions }) => (
  <li className="flex items-center gap-3 px-3 py-2.5">
    <i className="fa-solid fa-file-lines text-zinc-400"></i>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-bold text-zinc-700 truncate">{fileName}</div>
      <div className="text-xs text-zinc-400">{meta}</div>
    </div>
    {actions}
  </li>
);

export default AttachmentRow;
