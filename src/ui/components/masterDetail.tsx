/**
 * Shared master–detail layout for the vault domain views.
 *
 * Desktop-first and size-proof: the panes are driven by the *container's*
 * width (ResizeObserver), not the viewport, so the split is correct no matter
 * what chrome surrounds the view.
 *
 *   • Wide  → list pane (fixed width) + detail pane side by side.
 *   • Narrow → single pane: the list, or the selected item with a Back action.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { FiChevronLeft, FiPlus, FiSearch, FiX } from 'react-icons/fi';

/** Below this container width the layout collapses to a single pane. */
export const SPLIT_MIN = 880;

/** Measure an element's width, re-rendering on resize. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MasterDetail({
  hasSelection,
  list,
  detail,
  empty,
}: {
  hasSelection: boolean;
  list: (compact: boolean) => ReactNode;
  detail: (compact: boolean) => ReactNode;
  empty: ReactNode;
}) {
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const compact = width > 0 && width < SPLIT_MIN;
  const showList = !compact || !hasSelection;
  const showDetail = !compact || hasSelection;
  const listWidth = width >= 1200 ? 380 : 330;

  return (
    <div ref={rootRef} className="h-full flex min-w-0 overflow-hidden">
      {showList && (
        <section
          className={compact ? 'flex-1 min-w-0 flex flex-col' : 'shrink-0 border-r border-border flex flex-col'}
          style={compact ? undefined : { width: listWidth }}
        >
          {list(compact)}
        </section>
      )}
      {showDetail && (
        <div className="flex-1 min-w-0 flex flex-col">
          {hasSelection ? detail(compact) : empty}
        </div>
      )}
    </div>
  );
}

/** Standard list-pane header: title, count, New action, then controls. */
export function ListHeader({
  title,
  subtitle,
  onNew,
  newLabel = 'New',
  children,
}: {
  title: string;
  subtitle: ReactNode;
  onNew: () => void;
  newLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h1 className="font-display text-[17px] font-bold tracking-tight leading-none truncate">{title}</h1>
          <p className="mono-label mt-1.5">{subtitle}</p>
        </div>
        <button className="btn-primary !py-1.5 !px-3 text-[12px] shrink-0" onClick={onNew}>
          <FiPlus size={13} /> {newLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

/** Search field with the leading icon, clear button and `/` hint. */
export function SearchField({
  inputRef,
  value,
  onChange,
  placeholder,
}: {
  inputRef?: RefObject<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
      <input
        ref={inputRef}
        className="field pl-9 pr-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); e.currentTarget.blur(); } }}
      />
      {value ? (
        <button
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <FiX size={13} />
        </button>
      ) : (
        <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
      )}
    </div>
  );
}

/** Sticky detail header: back action (compact), title, badges, icon actions. */
export function DetailHeader({
  title,
  badges,
  subtitle,
  onBack,
  actions,
}: {
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-2 px-5 md:px-6 pt-5 pb-3.5 border-b border-border">
      {onBack && (
        <button className="icon-btn shrink-0 mt-0.5" onClick={onBack} title="Back to list" aria-label="Back to list">
          <FiChevronLeft size={18} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-display text-[18px] font-bold tracking-tight truncate">{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="mt-1.5 min-w-0">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </header>
  );
}

/** Scrollable, width-capped body for the detail pane. */
export function DetailBody({ maxWidth = 'max-w-3xl', children }: { maxWidth?: string; children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={'mx-auto w-full p-5 md:p-6 ' + maxWidth}>{children}</div>
    </div>
  );
}

/** Auto-fitting metadata grid — uses horizontal space instead of a long column. */
export function MetaGrid({ children }: { children: ReactNode }) {
  return (
    <section
      className="card px-4 py-3.5"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: '1.5rem' }}
    >
      {children}
    </section>
  );
}

export function MetaCell({ label, children, wrap = false, mono = false }: {
  label: string;
  children: ReactNode;
  wrap?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="py-2 min-w-0">
      <div className="mono-label">{label}</div>
      <div className={'text-[12.5px] mt-0.5 ' + (mono ? 'font-mono text-[11.5px] ' : '') + (wrap ? 'break-all' : 'truncate')}>
        {children}
      </div>
    </div>
  );
}
