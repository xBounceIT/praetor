import type React from 'react';
import { useLayoutEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const MIN_TEXTAREA_HEIGHT_PX = 36;

type LineItemNoteTextareaProps = Omit<React.ComponentProps<typeof Textarea>, 'ref' | 'rows'>;

const resizeToContent = (textarea: HTMLTextAreaElement) => {
  textarea.style.height = '0px';
  textarea.style.height = `${Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT_PX)}px`;
};

const LineItemNoteTextarea: React.FC<LineItemNoteTextareaProps> = ({
  className,
  onInput,
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (textareaRef.current) resizeToContent(textareaRef.current);
  });

  return (
    <Textarea
      {...props}
      ref={textareaRef}
      rows={1}
      onInput={(event) => {
        resizeToContent(event.currentTarget);
        onInput?.(event);
      }}
      className={cn(
        'min-h-9 resize-none overflow-hidden text-[1em] leading-normal md:text-[1em]',
        className,
      )}
    />
  );
};

export default LineItemNoteTextarea;
