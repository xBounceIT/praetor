import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPosition = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
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

const VIEWPORT_PADDING = 8;

const Tooltip: React.FC<TooltipProps> = ({
  label,
  position = 'top',
  disabled = false,
  wrapperClassName = '',
  tooltipClassName = '',
  children,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hasFlippedRef = useRef(false);
  const clampAppliedRef = useRef(false);
  const effectivePositionRef = useRef<TooltipPosition>(position);

  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [effectivePosition, setEffectivePosition] = useState<TooltipPosition>(position);
  const [arrowOffset, setArrowOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const calcCoords = useCallback((pos: TooltipPosition) => {
    if (!wrapperRef.current) return null;
    const rect = wrapperRef.current.getBoundingClientRect();
    const offset = 8;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    switch (pos) {
      case 'top':
        return { top: rect.top + scrollY - offset, left: rect.left + scrollX + rect.width / 2 };
      case 'bottom':
        return { top: rect.bottom + scrollY + offset, left: rect.left + scrollX + rect.width / 2 };
      case 'left':
        return { top: rect.top + scrollY + rect.height / 2, left: rect.left + scrollX - offset };
      case 'right':
        return { top: rect.top + scrollY + rect.height / 2, left: rect.right + scrollX + offset };
    }
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setEffectivePosition(position);
      effectivePositionRef.current = position;
      hasFlippedRef.current = false;
      clampAppliedRef.current = false;
    }
  }, [isVisible, position]);

  const updatePosition = useCallback(() => {
    hasFlippedRef.current = false;
    clampAppliedRef.current = false;
    effectivePositionRef.current = position;
    setEffectivePosition(position);
    setArrowOffset({ x: 0, y: 0 });
    const newCoords = calcCoords(position);
    if (newCoords) setCoords(newCoords);
  }, [calcCoords, position]);

  useEffect(() => {
    if (!isVisible) return;

    updatePosition();

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible, updatePosition]);

  useLayoutEffect(() => {
    if (!isVisible || !tooltipRef.current || !coords) return;

    const el = tooltipRef.current;
    const rect = el.getBoundingClientRect();

    if (!hasFlippedRef.current) {
      let flipped: TooltipPosition | null = null;

      switch (effectivePosition) {
        case 'top':
          if (rect.top < VIEWPORT_PADDING) flipped = 'bottom';
          break;
        case 'bottom':
          if (rect.bottom > window.innerHeight - VIEWPORT_PADDING) flipped = 'top';
          break;
        case 'left':
          if (rect.left < VIEWPORT_PADDING) flipped = 'right';
          break;
        case 'right':
          if (rect.right > window.innerWidth - VIEWPORT_PADDING) flipped = 'left';
          break;
      }

      if (flipped) {
        const newCoords = calcCoords(flipped);
        if (newCoords) {
          hasFlippedRef.current = true;
          effectivePositionRef.current = flipped;
          setEffectivePosition(flipped);
          setCoords(newCoords);
          return;
        }
      }
    }

    let dx = 0;
    let dy = 0;

    if (rect.left < VIEWPORT_PADDING) dx = VIEWPORT_PADDING - rect.left;
    else if (rect.right > window.innerWidth - VIEWPORT_PADDING)
      dx = window.innerWidth - VIEWPORT_PADDING - rect.right;

    if (rect.top < VIEWPORT_PADDING) dy = VIEWPORT_PADDING - rect.top;
    else if (rect.bottom > window.innerHeight - VIEWPORT_PADDING)
      dy = window.innerHeight - VIEWPORT_PADDING - rect.bottom;

    if ((dx !== 0 || dy !== 0) && !clampAppliedRef.current) {
      clampAppliedRef.current = true;
      setCoords((prev) => (prev ? { top: prev.top + dy, left: prev.left + dx } : prev));
      const isVertical = effectivePosition === 'top' || effectivePosition === 'bottom';
      const maxOffset = 4;
      if (isVertical) {
        const maxX = rect.width / 2 - maxOffset;
        const clampedX = Math.max(-maxX, Math.min(maxX, -dx));
        setArrowOffset({ x: clampedX, y: 0 });
      } else {
        const maxY = rect.height / 2 - maxOffset;
        const clampedY = Math.max(-maxY, Math.min(maxY, -dy));
        setArrowOffset({ x: 0, y: clampedY });
      }
    }
  }, [isVisible, coords, effectivePosition, calcCoords]);

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
              ref={tooltipRef}
              style={{ top: coords.top, left: coords.left }}
              className={`absolute ${positionClasses[effectivePosition]} px-3 py-1 bg-slate-800 text-white text-xs font-bold rounded pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700 ${tooltipClassName}`}
            >
              {label}
              <div
                className={`absolute w-2 h-2 bg-slate-800 border-slate-700 rotate-45 ${arrowClasses[effectivePosition]}`}
                style={{ marginLeft: arrowOffset.x, marginTop: arrowOffset.y }}
              ></div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default Tooltip;
