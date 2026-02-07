import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  label: React.ReactNode;
  position?: TooltipPosition;
  disabled?: boolean;
  wrapperClassName?: string;
  tooltipClassName?: string;
  children: () => React.ReactNode;
}

const positionClasses: Record<TooltipPosition, string> = {
  top: '-translate-x-1/2 -translate-y-full',
  right: '-translate-y-1/2',
  bottom: '-translate-x-1/2',
  left: '-translate-x-full -translate-y-1/2',
};

const arrowClasses: Record<TooltipPosition, string> = {
  top: 'left-1/2 -translate-x-1/2 -bottom-1 border-l border-b',
  right: '-left-1 top-1/2 -translate-y-1/2 border-l border-b',
  bottom: 'left-1/2 -translate-x-1/2 -top-1 border-l border-b',
  left: '-right-1 top-1/2 -translate-y-1/2 border-r border-t',
};

const Tooltip: React.FC<TooltipProps> = ({
  label,
  position = 'top',
  disabled = false,
  wrapperClassName = '',
  tooltipClassName = '',
  children,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();
    const offset = 8;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    switch (position) {
      case 'top':
        setCoords({
          top: rect.top + scrollY - offset,
          left: rect.left + scrollX + rect.width / 2,
        });
        break;
      case 'bottom':
        setCoords({
          top: rect.bottom + scrollY + offset,
          left: rect.left + scrollX + rect.width / 2,
        });
        break;
      case 'left':
        setCoords({
          top: rect.top + scrollY + rect.height / 2,
          left: rect.left + scrollX - offset,
        });
        break;
      case 'right':
        setCoords({
          top: rect.top + scrollY + rect.height / 2,
          left: rect.right + scrollX + offset,
        });
        break;
      default:
        setCoords({
          top: rect.top + scrollY - offset,
          left: rect.left + scrollX + rect.width / 2,
        });
    }
  }, [position]);

  useEffect(() => {
    if (!isVisible) return;

    updatePosition();

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isVisible, updatePosition]);

  const handleShow = () => {
    updatePosition();
    setIsVisible(true);
  };

  const handleHide = () => {
    setIsVisible(false);
  };

  if (disabled || label === null || label === undefined || label === '') {
    return <>{children()}</>;
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex ${wrapperClassName}`}
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
    >
      {children()}
      {isVisible && coords
        ? createPortal(
            <div
              style={{ top: coords.top, left: coords.left }}
              className={`absolute ${positionClasses[position]} px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700 ${tooltipClassName}`}
            >
              {label}
              <div
                className={`absolute w-2 h-2 bg-slate-800 border-slate-700 rotate-45 ${arrowClasses[position]}`}
              ></div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default Tooltip;
